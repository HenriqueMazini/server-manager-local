package analyze

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"servermanager/internal/config"
	"servermanager/internal/model"
)

func write(t *testing.T, root, rel, content string) {
	t.Helper()
	p := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// fixture monta um monorepo com problemas de propósito.
func fixture(t *testing.T) (root, dir string) {
	root = t.TempDir()
	dir = filepath.Join(root, "loja")
	write(t, dir, "api/docker-compose.yml", `
services:
  postgres:
    image: postgres:16
    ports: ["5432:5432"]
  search:
    image: meili:1
    environment:
      KEY: ${SEARCH_KEY}
      OTHER: ${WITH_DEFAULT:-x}
    ports: ["7700:7700"]
  api:
    build: .
    volumes: ["./uploads:/app/uploads"]
    ports: ["3001:3000"]
`)
	write(t, dir, "api/package.json", `{"scripts":{"start:dev":"nest start --watch"},"dependencies":{"@nestjs/core":"11"}}`)
	write(t, dir, "api/.env", "PORT=3001\nDATABASE_URL=postgresql://u:p@localhost:5433/db\nREDIS_HOST=localhost\nREDIS_PORT=6380\nSTRIPE_SECRET_KEY=sk_live_x\nSCHEDULER_ENABLED=true\n")
	write(t, dir, "api/.env.example", "PORT=3001\n")
	write(t, dir, "web/package.json", `{"scripts":{"dev":"next dev"},"dependencies":{"next":"16"},"engines":{"node":"^20"}}`)
	write(t, dir, "web/.env.example", "NEXT_PUBLIC_API=http://localhost:3001\n")
	if err := os.MkdirAll(filepath.Join(dir, "web/node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, dir, "api/prisma/schema.prisma", "")
	return root, dir
}

func snapshot() model.Snapshot {
	return model.Snapshot{
		Projects: []model.Project{{
			Key: "outro", Name: "Outro",
			Infra: []model.Container{
				{Name: "outro-db-1", Label: "db", ProjectKey: "outro", ComposeProject: "outro", WorkingDir: "/x/outro", Running: true, Ports: []model.Port{{HostPort: 5432}}},
				{Name: "legacy_redis", Label: "legacy_redis", Image: "redis:7", ProjectKey: "legacy_redis", Ports: []model.Port{{HostPort: 6380}}},
			},
		}},
		Ports: []model.PortEntry{{HostPort: 5432}, {HostPort: 6380}},
	}
}

func find(t *testing.T, r Result, title string) Check {
	t.Helper()
	for _, c := range r.Checks {
		if c.Title == title {
			return c
		}
	}
	var titles []string
	for _, c := range r.Checks {
		titles = append(titles, c.Title)
	}
	t.Fatalf("check %q não encontrado em %v", title, titles)
	return Check{}
}

func TestAnalyzeMonorepo(t *testing.T) {
	root, dir := fixture(t)
	r, err := Run(dir, root, snapshot(), config.Config{})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct{ title, status, want string }{
		{"Variáveis do api/docker-compose.yml", Fail, "SEARCH_KEY"},
		{"App api: dependências instaladas", Fail, "npm install"},
		{"App api: porta", OK, ""},
		{"App web: porta", Warn, "PORT"},
		{"App web: versão do Node", Info, ""},
		{"Arquivo .env em web", Fail, ".env.example"},
		{"Arquivo .env em api", OK, ""},
		{"Serviço em localhost:5433", Fail, "localhost:5433"},
		{"Serviço em localhost:6380", Warn, "legacy_redis"},
		{"Porta 5432", Fail, "5434"},
		{"Chaves de envio e cobrança", Warn, "STRIPE_SECRET_KEY"},
		{"Agendadores e workers", Warn, "SCHEDULER_ENABLED"},
		{"Dados de desenvolvimento", Info, "Prisma"},
	}
	for _, c := range cases {
		got := find(t, r, c.title)
		if got.Status != c.status {
			t.Errorf("%s: status %s, quero %s (%s)", c.title, got.Status, c.status, got.Detail)
		}
		if c.want != "" && !strings.Contains(got.Prompt, c.want) {
			t.Errorf("%s: prompt sem %q:\n%s", c.title, c.want, got.Prompt)
		}
		if c.status == Fail && !strings.HasPrefix(got.Prompt, "Estou preparando este projeto") {
			t.Errorf("%s: prompt sem contexto", c.title)
		}
	}
	if strings.Contains(find(t, r, "Chaves de envio e cobrança").Prompt, "sk_live_x") {
		t.Error("o prompt não pode expor valores secretos")
	}
	for _, c := range r.Checks {
		if c.Title == "Porta 3001" {
			t.Errorf("o serviço api do compose empacota o app e não deve disputar a porta 3001: %+v", c)
		}
	}
	if r.Ready {
		t.Error("com pendências obrigatórias não pode estar pronto")
	}
	if !strings.Contains(r.AllPrompts, "1. ") || strings.Count(r.AllPrompts, "Estou preparando") != 1 {
		t.Errorf("prompt combinado deve ter um cabeçalho e itens numerados:\n%s", r.AllPrompts)
	}
	for _, want := range []string{"compose: [api]", "containers: [legacy_redis]", "command: npm run start:dev", "port: 3001", "image: node:20-bookworm-slim", "name: Sistema"} {
		if !strings.Contains(r.Proposal, want) {
			t.Errorf("proposta sem %q:\n%s", want, r.Proposal)
		}
	}
}

func TestComposeSelection(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "site")
	write(t, dir, "docker-compose.yml", "services:\n  web:\n    image: nginx\n    ports: ['80:80']\n")
	write(t, dir, "docker-compose.local.yml", "name: site-dev\nservices:\n  web:\n    image: nginx\n    ports: ['127.0.0.1:8010:80']\n")
	write(t, dir, "docker-compose.prod.yml", "services: {}\n")

	cfs := findCompose(dir, nil)
	if len(cfs) != 1 || filepath.Base(cfs[0].Path) != "docker-compose.local.yml" || cfs[0].Project != "site-dev" {
		t.Fatalf("variante local deve ganhar: %+v", cfs)
	}
	if cfs[0].Services[0].Ports[0].Host != 8010 {
		t.Errorf("porta com IP: %+v", cfs[0].Services[0].Ports)
	}
	cfs = findCompose(dir, map[string]bool{filepath.Join(dir, "docker-compose.yml"): true})
	if filepath.Base(cfs[0].Path) != "docker-compose.yml" || cfs[0].Project != "site" {
		t.Fatalf("o arquivo em uso pelos containers deve ganhar: %+v", cfs[0])
	}
}

func TestAppInsideCompose(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "lara")
	write(t, dir, "docker-compose.yml", "services:\n  php:\n    image: php\n    volumes: ['./:/var/www']\n  node:\n    image: node:20\n    volumes: ['./:/app']\n    ports: ['5173:5173']\n")
	write(t, dir, "package.json", `{"scripts":{"dev":"vite"},"devDependencies":{"vite":"6"}}`)
	write(t, dir, "composer.json", "{}")
	r, err := Run(dir, root, model.Snapshot{}, config.Config{})
	if err != nil {
		t.Fatal(err)
	}
	c := find(t, r, "App .")
	if c.Status != Info || !strings.Contains(c.Detail, `"node"`) {
		t.Errorf("app deve rodar no serviço node do compose: %+v", c)
	}
	for _, c := range r.Checks {
		if c.Title == "Código que não é Node" {
			t.Errorf("PHP montado no compose não é pendência: %+v", c)
		}
	}
	if !strings.Contains(r.Proposal, "apps: []") {
		t.Errorf("sem apps próprios:\n%s", r.Proposal)
	}
}

func TestResolve(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "p"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := Resolve("/etc", root); err == nil {
		t.Error("fora da pasta de projetos deve falhar")
	}
	if _, err := Resolve(filepath.Join(root, "p", "..", ".."), root); err == nil {
		t.Error("subir com .. deve falhar")
	}
	if _, err := Resolve(filepath.Join(root, "nada"), root); err == nil {
		t.Error("pasta inexistente deve falhar")
	}
	if got, err := Resolve("p", root); err != nil || got != filepath.Join(root, "p") {
		t.Errorf("caminho relativo à pasta de projetos: %q %v", got, err)
	}
}

func TestListFolders(t *testing.T) {
	root := t.TempDir()
	write(t, root, "loja/docker-compose.yml", "services: {}\n")
	write(t, root, "site/web/package.json", "{}")
	write(t, root, ".oculta/x", "")
	write(t, root, "arquivo.txt", "")
	cfg := config.Config{Projects: map[string]config.ProjectCfg{"loja": {Name: "Loja", Dir: filepath.Join(root, "loja")}}}
	l := ListFolders(root, cfg)
	if !l.Exists || len(l.Folders) != 2 {
		t.Fatalf("esperava loja e site: %+v", l)
	}
	if l.Folders[0].Registered != "Loja" || !l.Folders[0].Compose || l.Folders[0].Node {
		t.Errorf("loja = %+v", l.Folders[0])
	}
	if !l.Folders[1].Node || l.Folders[1].Compose {
		t.Errorf("site = %+v", l.Folders[1])
	}

	missing := filepath.Join(root, "nao-existe")
	if l := ListFolders(missing, cfg); l.Exists || len(l.Folders) != 0 {
		t.Errorf("pasta inexistente não lista nada: %+v", l)
	}
	if exists(missing) {
		t.Error("listar não pode criar a pasta")
	}
}
