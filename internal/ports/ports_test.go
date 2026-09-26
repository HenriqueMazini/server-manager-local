package ports

import (
	"strings"
	"testing"

	"servermanager/internal/model"
)

func ctr(id, name, svc string, running bool, compose string, hp, cp uint16) model.Container {
	return model.Container{
		ID: id, Name: name, Image: "postgres:16", ProjectKey: svc, ProjectName: svc, Label: name, Role: "infra", Running: running,
		ComposeService: compose, WorkingDir: "/proj/" + svc, ConfigFiles: "/proj/" + svc + "/docker-compose.yml",
		Ports: []model.Port{{HostPort: hp, ContainerPort: cp, Proto: "tcp"}},
	}
}

func TestNoConflictForRunningContainersOwnPort(t *testing.T) {
	cs := []model.Container{ctr("1", "api-postgres-1", "api", true, "postgres", 5432, 5432)}
	ls := []model.HostListener{{Port: 5432, Proto: "tcp", Addr: "0.0.0.0"}}
	r := Analyze(cs, ls, nil)
	if len(r.Conflicts) != 0 {
		t.Fatalf("docker-proxy não é conflito: %+v", r.Conflicts)
	}
	if r.Listeners[0].OwnedByContainer != "api-postgres-1" {
		t.Errorf("listener deveria ser do container: %+v", r.Listeners[0])
	}
	if len(r.Entries) != 1 {
		t.Errorf("a porta do container não deve se repetir como processo do host: %+v", r.Entries)
	}
}

func TestContainerVsContainerAcrossProjects(t *testing.T) {
	cs := []model.Container{
		ctr("1", "api-postgres-1", "api", true, "postgres", 5432, 5432),
		ctr("2", "loja-db-1", "loja", false, "db", 5432, 5432),
		ctr("3", "loja_pg", "loja", true, "", 5433, 5432),
	}
	ls := []model.HostListener{{Port: 5432, Proto: "tcp", Addr: "0.0.0.0"}, {Port: 5433, Proto: "tcp", Addr: "0.0.0.0"}}
	r := Analyze(cs, ls, []uint16{5434})
	if len(r.Conflicts) != 1 {
		t.Fatalf("esperava 1 conflito, veio %+v", r.Conflicts)
	}
	c := r.Conflicts[0]
	if c.Kind != "container-container" || c.Mover.ContainerName != "loja-db-1" || c.Keeper.ContainerName != "api-postgres-1" {
		t.Errorf("quem muda deve ser o parado: %+v", c)
	}
	if c.ProposedPort != 5435 {
		t.Errorf("5433 está em uso e 5434 reservada: proposta %d", c.ProposedPort)
	}
	for _, want := range []string{"/proj/loja/docker-compose.yml", `"5432:5432" passa a ser "5435:5432"`, "docker compose up -d db", `"api-postgres-1"`} {
		if !strings.Contains(c.Prompt, want) {
			t.Errorf("prompt sem %q:\n%s", want, c.Prompt)
		}
	}
}

func TestSameServiceIsNotConflict(t *testing.T) {
	cs := []model.Container{
		ctr("1", "api-postgres-1", "api", false, "postgres", 5432, 5432),
		ctr("2", "api-postgres-old", "api", false, "postgres", 5432, 5432),
	}
	if r := Analyze(cs, nil, nil); len(r.Conflicts) != 0 {
		t.Fatalf("mesmo serviço não conflita: %+v", r.Conflicts)
	}
}

func TestStoppedContainerVsHostProcess(t *testing.T) {
	cs := []model.Container{ctr("1", "loja_redis", "loja", false, "", 6380, 6379)}
	ls := []model.HostListener{{Port: 6380, Proto: "tcp", Addr: "127.0.0.1"}, {Port: 6381, Proto: "tcp", Addr: "0.0.0.0"}}
	r := Analyze(cs, ls, nil)
	if len(r.Conflicts) != 1 {
		t.Fatalf("esperava conflito com processo do host: %+v", r.Conflicts)
	}
	c := r.Conflicts[0]
	if c.Kind != "container-host" || c.Keeper != nil || c.ProposedPort != 6382 {
		t.Errorf("conflito = %+v", c)
	}
	if !strings.Contains(c.Prompt, "criado fora do docker compose") || !strings.Contains(c.Prompt, "-p 6382:6379") {
		t.Errorf("prompt de container avulso:\n%s", c.Prompt)
	}
	hostEntries := 0
	for _, e := range r.Entries {
		if e.Kind == "host" {
			hostEntries++
		}
	}
	if hostEntries != 2 {
		t.Errorf("as duas portas do host devem aparecer no inventário: %+v", r.Entries)
	}
}

func TestDistinctSpecificIPsDoNotConflict(t *testing.T) {
	a := ctr("1", "a", "a", true, "x", 8080, 80)
	a.Ports[0].HostIP = "127.0.0.1"
	b := ctr("2", "b", "b", false, "y", 8080, 80)
	b.Ports[0].HostIP = "192.168.0.10"
	if r := Analyze([]model.Container{a, b}, nil, nil); len(r.Conflicts) != 0 {
		t.Fatalf("IPs específicos distintos não conflitam: %+v", r.Conflicts)
	}
}

func TestProposalsDoNotCollide(t *testing.T) {
	cs := []model.Container{
		ctr("1", "a-db-1", "a", true, "db", 5432, 5432),
		ctr("2", "b-db-1", "b", false, "db", 5432, 5432),
		ctr("3", "c-db-1", "c", false, "db", 5432, 5432),
	}
	r := Analyze(cs, nil, nil)
	if len(r.Conflicts) != 2 || r.Conflicts[0].ProposedPort == r.Conflicts[1].ProposedPort {
		t.Fatalf("propostas precisam ser distintas: %+v", r.Conflicts)
	}
}

func TestAppPortConflictAndStoppedAppIsNotHostConflict(t *testing.T) {
	app := model.Container{
		ID: "app:loja/web", Name: "sm-loja-web", Label: "Sistema", Role: "app", ProjectKey: "loja", ProjectName: "Loja",
		Command: "npm run dev", AppDir: "/proj/loja/web", Ports: []model.Port{{HostPort: 3000, ContainerPort: 3000, Proto: "tcp"}},
	}
	other := ctr("1", "grafana-1", "grafana", true, "grafana", 3000, 3000)
	r := Analyze([]model.Container{app, other}, []model.HostListener{{Port: 3000, Proto: "tcp", Addr: "0.0.0.0"}}, nil)
	if len(r.Conflicts) != 1 || !r.Conflicts[0].Mover.App {
		t.Fatalf("app parado deve ceder a porta ao container ligado: %+v", r.Conflicts)
	}
	if !strings.Contains(r.Conflicts[0].Prompt, "npm run dev") || !strings.Contains(r.Conflicts[0].Prompt, "services.yml") {
		t.Errorf("prompt de app:\n%s", r.Conflicts[0].Prompt)
	}

	r = Analyze([]model.Container{app}, []model.HostListener{{Port: 3000, Proto: "tcp", Addr: "0.0.0.0"}}, nil)
	if len(r.Conflicts) != 0 {
		t.Fatalf("app parado com porta ocupada vira aviso, não conflito: %+v", r.Conflicts)
	}
}
