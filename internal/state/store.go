// Package state mantém o snapshot atual e o distribui para os painéis conectados.
package state

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"servermanager/internal/claude"
	"servermanager/internal/config"
	"servermanager/internal/dockerx"
	"servermanager/internal/hostinfo"
	"servermanager/internal/model"
	"servermanager/internal/ports"
	"servermanager/internal/procfs"
	"servermanager/internal/projects"
	"servermanager/internal/version"
)

// Interval é o ritmo de atualização de memória e portas.
const Interval = 2 * time.Second

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

// TopAppsCount é quantos aplicativos o snapshot traz; o painel mostra só os acima de 1 GB.
const TopAppsCount = 12

// SelfName identifica a porta do painel no inventário de listeners.
const SelfName = "server-manager"

// Store guarda o último snapshot e avisa os assinantes a cada atualização.
type Store struct {
	dc      *dockerx.Client
	cfg     *config.Loader
	poke    chan struct{}
	mu      sync.RWMutex
	infos   []dockerx.Info
	listErr error
	snap    model.Snapshot
	subs    map[chan model.Snapshot]struct{}
}

// New cria o Store.
func New(dc *dockerx.Client, cfg *config.Loader) *Store {
	return &Store{dc: dc, cfg: cfg, poke: make(chan struct{}, 1), subs: map[chan model.Snapshot]struct{}{}}
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
	reserved := append([]uint16{SelfPort}, cfg.Ports.Reserved...)
	pr := ports.Analyze(all, listeners, reserved)
	snap.Projects, snap.Ports, snap.Conflicts, snap.Listeners = svcs, pr.Entries, pr.Conflicts, pr.Listeners
	// Uma leitura do /proc por atualização alimenta as sessões do Claude e os aplicativos da máquina.
	procs := procfs.Scan(ProcRoot)
	snap.Claude = claude.FromProcs(procs, filepath.Join(config.HostHome, ".claude", "sessions"), config.HostHome)
	snap.Apps = procfs.TopApps(procs, TopAppsCount)
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

// Subscribe devolve um canal com cada novo snapshot e a função para cancelar.
func (s *Store) Subscribe() (<-chan model.Snapshot, func()) {
	ch := make(chan model.Snapshot, 1)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	return ch, func() {
		s.mu.Lock()
		delete(s.subs, ch)
		s.mu.Unlock()
	}
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
