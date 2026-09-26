package dockerx

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/client"
)

// Labels dos containers de app criados pelo painel.
const (
	LabelAppProject = "server-manager.project"
	LabelAppKey     = "server-manager.app"
	LabelAppHash    = "server-manager.hash"
)

// AppSpec descreve o container que roda um app de desenvolvimento.
type AppSpec struct {
	Name       string // nome do container
	Project    string
	Key        string
	Image      string
	User       string
	Command    string
	WorkDir    string // pasta do app na máquina (o mesmo caminho dentro do container)
	MountDir   string // pasta montada: a raiz do projeto, para imports e submódulos fora do app
	Env        []string
	StopSecond int
}

// Hash muda sempre que algo que exige recriar o container muda.
func (s AppSpec) Hash() string {
	env := append([]string(nil), s.Env...)
	sort.Strings(env)
	h := sha256.Sum256([]byte(strings.Join([]string{s.Image, s.User, s.Command, s.WorkDir, s.MountDir, strings.Join(env, "\x00")}, "\x01")))
	return hex.EncodeToString(h[:8])
}

// RunApp liga o app: reaproveita o container se a configuração não mudou, senão recria.
func (c *Client) RunApp(ctx context.Context, s AppSpec) error {
	hash := s.Hash()
	ins, err := c.cli.ContainerInspect(ctx, s.Name, client.ContainerInspectOptions{})
	if err == nil {
		ct := ins.Container
		same := ct.Config != nil && ct.Config.Labels[LabelAppHash] == hash
		if same {
			if ct.State != nil && ct.State.Running {
				return nil
			}
			return c.Start(ctx, ct.ID)
		}
		if ct.Config == nil || ct.Config.Labels[LabelAppProject] == "" {
			return fmt.Errorf("já existe um container %q que não foi criado pelo painel", s.Name)
		}
		if _, err := c.cli.ContainerRemove(ctx, ct.ID, client.ContainerRemoveOptions{Force: true}); err != nil {
			return fmt.Errorf("recriar %s: %w", s.Name, err)
		}
	}
	if err := c.ensureImage(ctx, s.Image); err != nil {
		return err
	}
	init := true
	stop := s.StopSecond
	res, err := c.cli.ContainerCreate(ctx, client.ContainerCreateOptions{
		Name: s.Name,
		Config: &container.Config{
			Image:       s.Image,
			User:        s.User,
			Cmd:         []string{"sh", "-c", "exec " + s.Command},
			WorkingDir:  s.WorkDir,
			Env:         s.Env,
			Tty:         true,
			StopTimeout: &stop,
			Labels: map[string]string{
				LabelAppProject: s.Project,
				LabelAppKey:     s.Key,
				LabelAppHash:    hash,
			},
		},
		HostConfig: &container.HostConfig{
			NetworkMode: "host",
			Init:        &init,
			Mounts: []mount.Mount{{
				Type:   mount.TypeBind,
				Source: s.MountDir,
				Target: s.MountDir,
			}},
		},
	})
	if err != nil {
		return fmt.Errorf("criar %s: %w", s.Name, err)
	}
	return c.Start(ctx, res.ID)
}

func (c *Client) ensureImage(ctx context.Context, ref string) error {
	if _, err := c.cli.ImageInspect(ctx, ref); err == nil {
		return nil
	}
	resp, err := c.cli.ImagePull(ctx, ref, client.ImagePullOptions{})
	if err != nil {
		return fmt.Errorf("baixar imagem %s: %w", ref, err)
	}
	defer resp.Close()
	if err := resp.Wait(ctx); err != nil {
		return fmt.Errorf("baixar imagem %s: %w", ref, err)
	}
	return nil
}

// State devolve se o container está ligado e o status do healthcheck ("" quando não há).
func (c *Client) State(ctx context.Context, id string) (running bool, health string, err error) {
	ins, err := c.cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		return false, "", err
	}
	st := ins.Container.State
	if st == nil {
		return false, "", nil
	}
	if st.Health != nil {
		health = string(st.Health.Status)
	}
	return st.Running, health, nil
}

var ansi = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\r`)

// Logs devolve as últimas linhas do container, sem códigos de cor.
func (c *Client) Logs(ctx context.Context, id string, tail int) (string, error) {
	ins, err := c.cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		return "", err
	}
	rc, err := c.cli.ContainerLogs(ctx, id, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true, Tail: fmt.Sprint(tail)})
	if err != nil {
		return "", err
	}
	defer rc.Close()
	raw, err := io.ReadAll(io.LimitReader(rc, 2<<20))
	if err != nil {
		return "", err
	}
	if ins.Container.Config == nil || !ins.Container.Config.Tty {
		raw = demux(raw)
	}
	return ansi.ReplaceAllString(string(raw), ""), nil
}

// demux remove os cabeçalhos de 8 bytes que o Docker põe nos logs sem TTY.
func demux(b []byte) []byte {
	var out []byte
	for len(b) >= 8 {
		n := int(b[4])<<24 | int(b[5])<<16 | int(b[6])<<8 | int(b[7])
		b = b[8:]
		if n > len(b) {
			n = len(b)
		}
		out = append(out, b[:n]...)
		b = b[n:]
	}
	return out
}
