package projects

import (
	"strings"
	"testing"

	"servermanager/internal/config"
	"servermanager/internal/dockerx"
	"servermanager/internal/model"
)

func machine() []dockerx.Info {
	compose := func(svc string) map[string]string {
		return map[string]string{
			dockerx.LabelProject:     "api",
			dockerx.LabelService:     svc,
			dockerx.LabelWorkingDir:  "/home/dev/projetos/vendas/api",
			dockerx.LabelConfigFiles: "/home/dev/projetos/vendas/api/docker-compose.yml",
		}
	}
	return []dockerx.Info{
		{ID: "1", Name: "api-postgres-1", Image: "postgres:16-alpine", Running: true, Health: "healthy", Labels: compose("postgres"),
			Bindings: []dockerx.Binding{{HostPort: 5432, ContainerPort: 5432, Proto: "tcp"}}},
		{ID: "2", Name: "api-redis-1", Image: "redis:7-alpine", Running: true, Labels: compose("redis"),
			Bindings: []dockerx.Binding{{HostPort: 6379, ContainerPort: 6379, Proto: "tcp"}}},
		{ID: "3", Name: "vendas_pg", Image: "postgres:15", Running: true, Labels: map[string]string{},
			Bindings: []dockerx.Binding{{HostPort: 5433, ContainerPort: 5432, Proto: "tcp"}}},
		{ID: "4", Name: "vendas_redis", Image: "redis:7-alpine", Running: true, Labels: map[string]string{},
			Bindings: []dockerx.Binding{{HostPort: 6380, ContainerPort: 6379, Proto: "tcp"}}},
		{ID: "5", Name: "server-manager", Running: true, Labels: map[string]string{dockerx.LabelSelf: "true"}},
		{ID: "6", Name: "loja-db-1", Image: "mysql:8", Running: false, Labels: map[string]string{dockerx.LabelProject: "loja"},
			Bindings: []dockerx.Binding{{HostPort: 3306, ContainerPort: 3306, Proto: "tcp"}}},
	}
}

const vendasYAML = `
projects:
  vendas:
    name: Vendas
    dir: /home/dev/projetos/vendas
    compose: [api]
    containers: [vendas_pg, vendas_redis]
    apps:
      - { key: web, name: Sistema, dir: frontend, command: npm run dev, port: 3000 }
      - { key: api, name: API, dir: api, command: npm run start:dev, port: 3001, url: "http://localhost:3001/docs" }
`

func TestProjectConsolidatesInfraAndApps(t *testing.T) {
	cfg, err := config.Parse([]byte(vendasYAML))
	if err != nil {
		t.Fatal(err)
	}
	mem := map[string]dockerx.Mem{"1": {Used: 90 << 20}, "2": {Used: 5 << 20}, "3": {Used: 120 << 20}, "4": {Used: 4 << 20}}
	ps, all := Build(machine(), mem, nil, cfg)
	if len(ps) != 2 || ps[0].Key != "vendas" || ps[1].Key != "loja" {
		t.Fatalf("projetos = %+v", ps)
	}
	p := ps[0]
	if p.Name != "Vendas" || len(p.Infra) != 4 || len(p.Apps) != 2 || p.Total != 6 || p.Running != 4 {
		t.Fatalf("vendas = %+v", p)
	}
	if p.State != "partial" || p.MemUsed != 219<<20 {
		t.Errorf("estado/memória = %s %d", p.State, p.MemUsed)
	}
	if p.Infra[0].Name != "vendas_pg" {
		t.Errorf("bancos avulsos de dev vêm antes do compose: %s", p.Infra[0].Name)
	}
	if len(p.Links) != 2 || p.Links[0].URL != "http://localhost:3000" || p.Links[1].URL != "http://localhost:3001/docs" {
		t.Errorf("links = %+v", p.Links)
	}
	web := p.Apps[0]
	if web.Exists || web.Running || web.Name != "sm-vendas-web" || web.AppDir != "/home/dev/projetos/vendas/frontend" {
		t.Errorf("app nunca ligado = %+v", web)
	}
	if len(all) != 7 {
		t.Errorf("todos os itens (5 containers + 2 apps) reservam porta: %d", len(all))
	}
}

func TestAppStatesFromDockerAndListeners(t *testing.T) {
	cfg, _ := config.Parse([]byte(vendasYAML))
	infos := append(machine(),
		dockerx.Info{ID: "w", Name: "sm-vendas-web", Running: true, Labels: map[string]string{dockerx.LabelAppProject: "vendas"}},
		dockerx.Info{ID: "a", Name: "sm-vendas-api", Running: true, Labels: map[string]string{dockerx.LabelAppProject: "vendas"}},
	)
	ls := []model.HostListener{{Port: 3000, Proto: "tcp"}}
	ps, _ := Build(infos, nil, ls, cfg)
	p := ps[0]
	if !p.Apps[0].Listening || p.Apps[1].Listening {
		t.Errorf("web já escuta, api ainda sobe: %+v", p.Apps)
	}
	if p.State != "starting" {
		t.Errorf("estado = %s, quero starting", p.State)
	}
	ls = append(ls, model.HostListener{Port: 3001, Proto: "tcp"})
	if ps, _ = Build(infos, nil, ls, cfg); ps[0].State != "on" {
		t.Errorf("estado = %s, quero on", ps[0].State)
	}
}

func TestExternalPortWarning(t *testing.T) {
	cfg, _ := config.Parse([]byte(vendasYAML))
	ps, _ := Build(machine(), nil, []model.HostListener{{Port: 3000, Proto: "tcp"}}, cfg)
	p := ps[0]
	if !p.Apps[0].External || len(p.Warnings) != 1 || !strings.Contains(p.Warnings[0], "3000") {
		t.Errorf("aviso de porta ocupada: %+v %v", p.Apps[0], p.Warnings)
	}
}

func TestSpec(t *testing.T) {
	cfg, _ := config.Parse([]byte(vendasYAML))
	pc := cfg.Projects["vendas"]
	s := Spec("vendas", pc, pc.Apps[1])
	if s.MountDir != "/home/dev/projetos/vendas" || s.WorkDir != "/home/dev/projetos/vendas/api" || s.Name != "sm-vendas-api" {
		t.Errorf("spec = %+v", s)
	}
	h := s.Hash()
	s.Command = "npm run dev"
	if s.Hash() == h {
		t.Error("mudar o comando deve recriar o container")
	}
}

func TestURLFor(t *testing.T) {
	cases := []struct {
		image, ip string
		hp, cp    uint16
		want      string
	}{
		{"getmeili/meilisearch:v1.15", "", 7700, 7700, "http://localhost:7700"},
		{"mongo:7", "", 27018, 27017, "mongodb://localhost:27018"},
		{"nginx", "", 8443, 443, "https://localhost:8443"},
		{"mariadb:11", "127.0.0.1", 3307, 3306, "mysql://localhost:3307"},
	}
	for _, c := range cases {
		if got := URLFor(c.image, c.ip, c.hp, c.cp, "tcp"); got != c.want {
			t.Errorf("URLFor(%s) = %s, quero %s", c.image, got, c.want)
		}
	}
}
