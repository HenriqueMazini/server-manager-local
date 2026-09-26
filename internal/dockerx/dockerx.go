// Package dockerx encapsula o cliente oficial do Docker nas poucas operações que o painel usa.
package dockerx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/events"
	"github.com/moby/moby/client"
	"golang.org/x/sync/errgroup"
)

// Labels do Compose usados no agrupamento.
const (
	LabelProject     = "com.docker.compose.project"
	LabelService     = "com.docker.compose.service"
	LabelWorkingDir  = "com.docker.compose.project.working_dir"
	LabelConfigFiles = "com.docker.compose.project.config_files"
	LabelNumber      = "com.docker.compose.container-number"
	// LabelSelf marca o próprio Server Manager, que nunca aparece na lista.
	LabelSelf = "server-manager.self"
)

// Binding é uma porta publicada, lida de HostConfig.PortBindings (vale também para container parado).
type Binding struct {
	HostIP        string
	HostPort      uint16
	ContainerPort uint16
	Proto         string
}

// Info é o que o painel precisa saber de um container.
type Info struct {
	ID       string
	Name     string
	Image    string
	State    string
	Status   string
	Health   string
	Running  bool
	Labels   map[string]string
	Bindings []Binding
}

// Mem é a memória usada por um container, no mesmo cálculo do `docker stats`.
type Mem struct {
	Used  uint64
	Limit uint64
}

// Client é o cliente Docker do painel.
type Client struct{ cli *client.Client }

// New conecta via DOCKER_HOST ou /var/run/docker.sock, negociando a versão da API.
func New() (*Client, error) {
	cli, err := client.New(client.FromEnv)
	if err != nil {
		return nil, err
	}
	return &Client{cli: cli}, nil
}

// Close libera o cliente.
func (c *Client) Close() error { return c.cli.Close() }

// Ping verifica se o daemon responde.
func (c *Client) Ping(ctx context.Context) error {
	_, err := c.cli.Ping(ctx, client.PingOptions{})
	return err
}

// List devolve todos os containers, inclusive parados, com as portas de HostConfig.
func (c *Client) List(ctx context.Context) ([]Info, error) {
	res, err := c.cli.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err != nil {
		return nil, err
	}
	out := make([]Info, len(res.Items))
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(8)
	for i, s := range res.Items {
		g.Go(func() error {
			info := Info{
				ID:      s.ID,
				Image:   s.Image,
				State:   string(s.State),
				Status:  s.Status,
				Running: s.State == container.StateRunning,
				Labels:  s.Labels,
			}
			if len(s.Names) > 0 {
				info.Name = strings.TrimPrefix(s.Names[0], "/")
			}
			ins, err := c.cli.ContainerInspect(gctx, s.ID, client.ContainerInspectOptions{})
			if err != nil {
				// Container removido entre o list e o inspect: segue sem portas.
				out[i] = info
				return nil
			}
			ct := ins.Container
			if ct.Config != nil && ct.Config.Image != "" {
				info.Image = ct.Config.Image
			}
			if ct.State != nil && ct.State.Health != nil {
				info.Health = string(ct.State.Health.Status)
			}
			if ct.HostConfig != nil {
				info.Bindings = bindingsOf(ct.HostConfig.PortBindings)
			}
			out[i] = info
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func bindingsOf(pm map[networkPort][]networkBinding) []Binding {
	type key struct {
		port  uint16
		proto string
		ip    string
	}
	seen := map[key]bool{}
	var out []Binding
	for p, bs := range pm {
		for _, b := range bs {
			hp, err := strconv.ParseUint(b.HostPort, 10, 16)
			if err != nil || hp == 0 {
				continue // porta efêmera: o Docker escolhe na hora de subir
			}
			ip := ""
			if b.HostIP.IsValid() && !b.HostIP.IsUnspecified() {
				ip = b.HostIP.String()
			}
			k := key{uint16(hp), string(p.Proto()), ip}
			if seen[k] {
				continue
			}
			seen[k] = true
			out = append(out, Binding{HostIP: ip, HostPort: uint16(hp), ContainerPort: p.Num(), Proto: string(p.Proto())})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].HostPort != out[j].HostPort {
			return out[i].HostPort < out[j].HostPort
		}
		return out[i].Proto < out[j].Proto
	})
	return out
}

// Start liga um container.
func (c *Client) Start(ctx context.Context, id string) error {
	_, err := c.cli.ContainerStart(ctx, id, client.ContainerStartOptions{})
	return err
}

// Stop desliga um container respeitando o stop_grace_period dele.
func (c *Client) Stop(ctx context.Context, id string) error {
	_, err := c.cli.ContainerStop(ctx, id, client.ContainerStopOptions{})
	return err
}

// Memory lê uma amostra de memória de cada container informado.
func (c *Client) Memory(ctx context.Context, ids []string) map[string]Mem {
	out := make(map[string]Mem, len(ids))
	res := make([]Mem, len(ids))
	ok := make([]bool, len(ids))
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(8)
	for i, id := range ids {
		g.Go(func() error {
			m, err := c.memoryOf(gctx, id)
			if err == nil {
				res[i], ok[i] = m, true
			}
			return nil
		})
	}
	_ = g.Wait()
	for i, id := range ids {
		if ok[i] {
			out[id] = res[i]
		}
	}
	return out
}

func (c *Client) memoryOf(ctx context.Context, id string) (Mem, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	res, err := c.cli.ContainerStats(ctx, id, client.ContainerStatsOptions{Stream: false})
	if err != nil {
		return Mem{}, err
	}
	defer res.Body.Close()
	var s container.StatsResponse
	if err := json.NewDecoder(res.Body).Decode(&s); err != nil {
		return Mem{}, err
	}
	return MemFromStats(s.MemoryStats), nil
}

// MemFromStats aplica o cálculo do `docker stats`: uso menos cache inativo.
func MemFromStats(ms container.MemoryStats) Mem {
	used := ms.Usage
	inactive, ok := ms.Stats["inactive_file"] // cgroup v2
	if !ok {
		inactive = ms.Stats["total_inactive_file"] // cgroup v1
	}
	if inactive < used {
		used -= inactive
	}
	return Mem{Used: used, Limit: ms.Limit}
}

// WatchEvents chama onChange a cada mudança de estado de container até o contexto acabar.
// Reconecta com espera crescente quando o daemon cai.
func (c *Client) WatchEvents(ctx context.Context, onChange func()) {
	backoff := time.Second
	for ctx.Err() == nil {
		err := c.watchOnce(ctx, onChange)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			onChange() // o painel precisa refletir que o Docker sumiu
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}

var relevant = map[events.Action]bool{
	events.ActionStart: true, events.ActionStop: true, events.ActionDie: true,
	events.ActionKill: true, events.ActionCreate: true, events.ActionDestroy: true,
	events.ActionRename: true, events.ActionPause: true, events.ActionUnPause: true,
	events.ActionRestart: true, events.ActionHealthStatusHealthy: true,
	events.ActionHealthStatusUnhealthy: true,
}

func (c *Client) watchOnce(ctx context.Context, onChange func()) error {
	res := c.cli.Events(ctx, client.EventsListOptions{Filters: client.Filters{}.Add("type", string(events.ContainerEventType))})
	onChange() // eventos perdidos durante a reconexão
	for {
		select {
		case <-ctx.Done():
			return nil
		case m, ok := <-res.Messages:
			if !ok {
				return errors.New("canal de eventos fechado")
			}
			if relevant[m.Action] || strings.HasPrefix(string(m.Action), "health_status") {
				onChange()
			}
		case err := <-res.Err:
			if err == nil {
				return errors.New("eventos encerrados")
			}
			return fmt.Errorf("eventos: %w", err)
		}
	}
}
