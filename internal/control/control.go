// Package control liga e desliga um projeto inteiro na ordem certa.
package control

import (
	"context"
	"fmt"
	"sync"
	"time"

	"servermanager/internal/config"
	"servermanager/internal/dockerx"
	"servermanager/internal/model"
	"servermanager/internal/projects"
)

// Result é o resultado da ação em um item do projeto.
type Result struct {
	Name  string `json:"name"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// HealthWait é quanto a infraestrutura pode levar para ficar saudável antes de subir os apps.
const HealthWait = 90 * time.Second

// Start liga a infraestrutura, espera ela ficar pronta e então sobe os apps em ordem.
func Start(ctx context.Context, dc *dockerx.Client, cfg config.Config, p model.Project) []Result {
	var results []Result
	infra := parallel(p.Infra, func(c model.Container) (bool, error) {
		if c.Running {
			return false, nil
		}
		return true, dc.Start(ctx, c.ID)
	})
	results = append(results, infra...)
	waitReady(ctx, dc, p.Infra)

	pc := cfg.Projects[p.Key]
	for _, app := range p.Apps {
		if app.Running {
			continue
		}
		r := Result{Name: app.Label, OK: true}
		ac, ok := appCfg(pc, app)
		switch {
		case !ok:
			r.OK, r.Error = false, "app não está mais no services.yml"
		case app.External:
			r.OK, r.Error = false, fmt.Sprintf("porta %d já está em uso fora do painel", ac.Port)
		default:
			if err := dc.RunApp(ctx, projects.Spec(p.Key, pc, ac)); err != nil {
				r.OK, r.Error = false, err.Error()
			}
		}
		results = append(results, r)
	}
	return results
}

// Stop desliga os apps primeiro e depois a infraestrutura.
func Stop(ctx context.Context, dc *dockerx.Client, p model.Project) []Result {
	results := parallel(p.Apps, func(c model.Container) (bool, error) {
		if !c.Running || !c.Exists {
			return false, nil
		}
		return true, dc.Stop(ctx, c.ID)
	})
	return append(results, parallel(p.Infra, func(c model.Container) (bool, error) {
		if !c.Running {
			return false, nil
		}
		return true, dc.Stop(ctx, c.ID)
	})...)
}

func appCfg(pc config.ProjectCfg, app model.Container) (config.AppCfg, bool) {
	for _, a := range pc.Apps {
		if projects.AppContainerName(app.ProjectKey, a.Key) == app.Name {
			return a, true
		}
	}
	return config.AppCfg{}, false
}

func parallel(items []model.Container, fn func(model.Container) (bool, error)) []Result {
	var (
		mu  sync.Mutex
		wg  sync.WaitGroup
		out []Result
	)
	for _, c := range items {
		wg.Go(func() {
			acted, err := fn(c)
			if !acted {
				return
			}
			r := Result{Name: c.Label, OK: err == nil}
			if err != nil {
				r.Error = err.Error()
			}
			mu.Lock()
			out = append(out, r)
			mu.Unlock()
		})
	}
	wg.Wait()
	return out
}

// waitReady espera cada container ligar e, se tiver healthcheck, sair de "starting".
func waitReady(ctx context.Context, dc *dockerx.Client, infra []model.Container) {
	deadline := time.Now().Add(HealthWait)
	for _, c := range infra {
		for time.Now().Before(deadline) {
			running, health, err := dc.State(ctx, c.ID)
			if err != nil || (running && health != "starting") {
				break
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(500 * time.Millisecond):
			}
		}
	}
}

// Restart devolve a memória acumulada pelos servidores de desenvolvimento: para os apps
// (o que mata a árvore inteira de processos, inclusive instâncias órfãs do modo watch)
// e sobe de novo. Projetos sem apps reiniciam os containers.
func Restart(ctx context.Context, dc *dockerx.Client, cfg config.Config, p model.Project) []Result {
	if len(p.Apps) == 0 {
		results := Stop(ctx, dc, p)
		p.Infra = stopped(p.Infra)
		return append(results, Start(ctx, dc, cfg, p)...)
	}
	results := parallel(p.Apps, func(c model.Container) (bool, error) {
		if !c.Running || !c.Exists {
			return false, nil
		}
		return true, dc.Stop(ctx, c.ID)
	})
	p.Apps = stopped(p.Apps)
	return append(results, Start(ctx, dc, cfg, p)...)
}

func stopped(cs []model.Container) []model.Container {
	out := make([]model.Container, len(cs))
	for i, c := range cs {
		c.Running = false
		out[i] = c
	}
	return out
}
