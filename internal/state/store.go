// Package state mantém o snapshot atual e o distribui para os painéis conectados.
package state

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"servermanager/internal/claude"
	"servermanager/internal/config"
	"servermanager/internal/devprocs"
	"servermanager/internal/diskx"
	"servermanager/internal/dockerx"
	"servermanager/internal/hostinfo"
	"servermanager/internal/labels"
	"servermanager/internal/model"
	"servermanager/internal/ports"
	"servermanager/internal/procfs"
	"servermanager/internal/projects"
	"servermanager/internal/version"
)

// Interval é o ritmo de atualização de memória e portas com o painel aberto.
const Interval = 2 * time.Second

// IdleInterval é o ritmo sem ninguém olhando (nenhuma aba conectada): cada leitura percorre todos os
// processos do computador, e não há por que fazer isso a cada 2 s para ninguém.
const IdleInterval = 30 * time.Second

// SelfPort é a porta do próprio painel, que nunca é proposta como porta livre.
var SelfPort uint16 = 9090

// ProcRoot é o /proc do computador. No container ele é montado em /host/proc; fora do Docker, é o /proc.
var ProcRoot = procRoot()

func procRoot() string {
	if v := os.Getenv("SM_PROC_ROOT"); v != "" {
		return v
	}
	if _, err := os.Stat("/host/proc"); err == nil {
		return "/host/proc"
	}
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return "" // dentro de um container sem /host/proc: não há como ver as sessões
	}
	return "/proc"
}

// HelperSocket é o socket do ajudante da máquina (helper/ajudante.py), dentro da pasta de dados.
// main define a partir de SM_DATA_DIR.
var HelperSocket = filepath.Join("data", "ajudante.sock")

// TopAppsCount é quantos aplicativos o snapshot traz; o painel mostra só os acima de 1 GB.
const TopAppsCount = 12

// SelfName identifica a porta do painel no inventário de listeners.
const SelfName = "server-manager"

// Store guarda o último snapshot e avisa os assinantes a cada atualização.
type Store struct {
	dc      *dockerx.Client
	cfg     *config.Loader
	labels  *labels.Store
	poke    chan struct{}
	mu      sync.RWMutex
	infos   []dockerx.Info
	listErr error
	snap    model.Snapshot
	subs    map[chan model.Snapshot]struct{}
	disk    *Disk
}

// New cria o Store.
func New(dc *dockerx.Client, cfg *config.Loader, lb *labels.Store) *Store {
	return &Store{dc: dc, cfg: cfg, labels: lb, poke: make(chan struct{}, 1), subs: map[chan model.Snapshot]struct{}{}, disk: newDisk(dc)}
}

// Poke pede uma releitura imediata dos containers.
func (s *Store) Poke() {
	select {
	case s.poke <- struct{}{}:
	default:
	}
}

// Run atualiza o estado até o contexto acabar.
func (s *Store) Run(ctx context.Context) {
	go s.dc.WatchEvents(ctx, s.Poke)
	go s.disk.watch(ctx)
	s.reload(ctx)
	s.tick(ctx)
	t := time.NewTicker(Interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.poke:
			// Uma ação em grupo gera vários eventos seguidos: junta tudo numa leitura só.
			time.Sleep(150 * time.Millisecond)
			select {
			case <-s.poke:
			default:
			}
			s.reload(ctx)
			s.tick(ctx)
		case <-t.C:
			if !s.watched() && time.Since(s.Snapshot().At) < IdleInterval {
				continue
			}
			if s.hasListErr() {
				s.reload(ctx)
			}
			s.tick(ctx)
		}
	}
}

func (s *Store) hasListErr() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.listErr != nil
}

func (s *Store) reload(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	infos, err := s.dc.List(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		if s.listErr == nil {
			slog.Warn("docker indisponível", "err", err)
		}
		s.listErr = err
		return
	}
	s.infos, s.listErr = infos, nil
}

func (s *Store) tick(ctx context.Context) {
	s.mu.RLock()
	infos, listErr := s.infos, s.listErr
	s.mu.RUnlock()

	snap := model.Snapshot{At: time.Now(), Version: version.Current, Docker: listErr == nil}
	if listErr != nil {
		snap.Error = "Docker indisponível: " + listErr.Error()
		infos = nil
	}

	cfg, cfgErr := s.cfg.Get()
	if cfgErr != nil && snap.Error == "" {
		snap.Error = "services.yml inválido: " + cfgErr.Error()
	}
	if mem, err := hostinfo.ReadMem(); err == nil {
		snap.Host = mem
	}
	listeners, err := hostinfo.ReadListeners()
	if err != nil {
		slog.Warn("falha ao ler portas do host", "err", err)
	}
	for i := range listeners {
		if listeners[i].Port == SelfPort {
			listeners[i].OwnedByContainer = SelfName
		}
	}

	var running []string
	for _, in := range infos {
		if in.Running {
			running = append(running, in.ID)
		}
	}
	mem := s.dc.Memory(ctx, running)

	svcs, all := projects.Build(infos, mem, listeners, cfg)
	snap.Orphans = projects.Orphans(infos, cfg)
	snap.Temporary = projects.Temporaries(infos)
	aliases := s.labels.All()
	for i := range svcs {
		svcs[i].Alias = aliases[svcs[i].Key]
	}
	reserved := append([]uint16{SelfPort}, cfg.Ports.Reserved...)
	pr := ports.Analyze(all, listeners, reserved)
	snap.Projects, snap.Ports, snap.Conflicts, snap.Listeners = svcs, pr.Entries, pr.Conflicts, pr.Listeners
	// Uma leitura do /proc por atualização alimenta as sessões do Claude e os aplicativos da máquina.
	procs := procfs.Scan(ProcRoot)
	snap.Claude = claude.FromProcs(procs, filepath.Join(config.HostHome, ".claude", "sessions"), config.HostHome)
	snap.Claude.CanDelete = claude.HelperAvailable(HelperSocket)
	if snap.Claude.Available {
		open := map[string]bool{}
		for _, s := range snap.Claude.Sessions {
			open[s.ID] = true
		}
		snap.Claude.Closed = claude.Closed(filepath.Join(config.HostHome, ".claude", "projects"), config.HostHome, open)
	}
	snap.Apps = procfs.TopApps(procs, TopAppsCount)
	snap.SwapApps = procfs.TopSwap(procs, 8)
	snap.DevRuns = devprocs.Find(procs, snap.Projects, config.ProjectsRoot(), config.HostHome)
	containerSwap(snap.Projects, procs)
	// Onde fica o Docker (a raiz do container fica no mesmo disco) e a pasta pessoal, se for outro.
	snap.Disks = diskx.Filesystems("/", config.HostHome)
	if ProcRoot != "" {
		snap.Pressure = hostinfo.ReadPressure(ProcRoot)
	}
	if snap.Projects == nil {
		snap.Projects = []model.Project{}
	}
	if snap.Listeners == nil {
		snap.Listeners = []model.HostListener{}
	}

	s.mu.Lock()
	s.snap = snap
	for ch := range s.subs {
		select {
		case ch <- snap:
		default: // painel lento: recebe o próximo
		}
	}
	s.mu.Unlock()
}

// Snapshot devolve o estado atual.
func (s *Store) Snapshot() model.Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snap
}

// watched diz se alguma aba está conectada recebendo as atualizações.
func (s *Store) watched() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.subs) > 0
}

// Fresh devolve um snapshot de no máximo Interval atrás. Sem abas conectadas o último pode ter até
// IdleInterval: pede uma leitura e espera por ela (até 5 s).
func (s *Store) Fresh(ctx context.Context) model.Snapshot {
	if snap := s.Snapshot(); time.Since(snap.At) <= Interval {
		return snap
	}
	ch, cancel := s.Subscribe()
	defer cancel()
	select {
	case snap := <-ch:
		return snap
	case <-time.After(5 * time.Second):
	case <-ctx.Done():
	}
	return s.Snapshot()
}

// Subscribe devolve um canal com cada novo snapshot e a função para cancelar. Quem chega com o painel
// parado (sem abas) recebe uma leitura nova na hora.
func (s *Store) Subscribe() (<-chan model.Snapshot, func()) {
	ch := make(chan model.Snapshot, 1)
	s.mu.Lock()
	idle := len(s.subs) == 0
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	if idle && time.Since(s.Snapshot().At) > Interval {
		s.Poke()
	}
	return ch, func() {
		s.mu.Lock()
		delete(s.subs, ch)
		s.mu.Unlock()
	}
}

// Disk é o relatório de disco do Docker, com cache.
func (s *Store) Disk() *Disk { return s.disk }

// Infos devolve a última lista de containers lida do Docker.
func (s *Store) Infos() []dockerx.Info {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.infos
}

// Config devolve o services.yml atual.
func (s *Store) Config() config.Config {
	c, _ := s.cfg.Get()
	return c
}

// Item procura um container ou app existente pelo ID.
func (s *Store) Item(id string) (model.Container, bool) {
	for _, p := range s.Snapshot().Projects {
		for _, list := range [][]model.Container{p.Apps, p.Infra} {
			for _, c := range list {
				if c.ID == id && c.Exists {
					return c, true
				}
			}
		}
	}
	return model.Container{}, false
}

// Project procura um projeto visível pela chave.
func (s *Store) Project(key string) (model.Project, bool) {
	for _, p := range s.Snapshot().Projects {
		if p.Key == key {
			return p, true
		}
	}
	return model.Project{}, false
}

// containerSwap soma o swap dos processos de cada container (pelo cgroup docker-<id>.scope) nos
// containers e projetos. O Docker não informa o swap; o /proc de cada processo informa.
func containerSwap(ps []model.Project, procs map[int]procfs.Proc) {
	byID := map[string]uint64{}
	for _, p := range procs {
		if p.Swap == 0 || !p.Container {
			continue
		}
		id := strings.TrimSuffix(strings.TrimPrefix(p.Unit, "docker-"), ".scope")
		if id != p.Unit {
			byID[id] += p.Swap
		}
	}
	if len(byID) == 0 {
		return
	}
	for i := range ps {
		ps[i].SwapUsed = 0
		for _, list := range [][]model.Container{ps[i].Apps, ps[i].Infra} {
			for j := range list {
				list[j].SwapUsed = byID[list[j].ID]
				ps[i].SwapUsed += list[j].SwapUsed
			}
		}
	}
}
