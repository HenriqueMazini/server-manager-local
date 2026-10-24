package devprocs

import (
	"os"
	"path/filepath"
	"testing"

	"servermanager/internal/model"
	"servermanager/internal/procfs"
)

const mb = 1024 * 1024

func TestFind(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(home, "projetos")
	loja := filepath.Join(root, "loja")
	// Repositório principal com um submódulo "web" e uma worktree dele em loja-wt/feature/web.
	must(t, os.MkdirAll(filepath.Join(loja, ".git", "modules", "web", "worktrees", "web2"), 0o755))
	wt := filepath.Join(root, "loja-wt", "feature", "web")
	must(t, os.MkdirAll(wt, 0o755))
	must(t, os.WriteFile(filepath.Join(wt, ".git"), []byte("gitdir: "+filepath.Join(loja, ".git", "modules", "web", "worktrees", "web2")+"\n"), 0o644))

	procs := map[int]procfs.Proc{
		1:  {PID: 1, Comm: "systemd"},
		50: {PID: 50, PPID: 1, Comm: "systemd", Unit: "init.scope"},
		60: {PID: 60, PPID: 50, Comm: "bash", Argv: []string{"-bash"}, Unit: "tmux-spawn.scope"},
		// Servidor esquecido: o terminal fechou e o npm ficou pendurado no systemd do usuário.
		100: {PID: 100, PPID: 50, Comm: "npm run dev", Argv: []string{"npm", "run", "dev"}, RSS: 10 * mb, Start: "777"},
		101: {PID: 101, PPID: 100, Comm: "sh", Argv: []string{"sh", "-c", "next dev"}, RSS: 1 * mb},
		102: {PID: 102, PPID: 101, Comm: "MainThread", Argv: []string{"node", filepath.Join(wt, "node_modules/.bin/next"), "dev"}, RSS: 30 * mb},
		103: {PID: 103, PPID: 102, Comm: "next-server (v1", Argv: []string{"next-server (v16.3.1)"}, RSS: 500 * mb},
		// Rodando num terminal aberto, na pasta do projeto.
		200: {PID: 200, PPID: 60, Comm: "MainThread", Argv: []string{"node", filepath.Join(loja, "api/node_modules/.bin/nest"), "start", "--watch"}, RSS: 300 * mb},
		// Container: já está no projeto.
		300: {PID: 300, PPID: 1, Comm: "node", Argv: []string{"node", filepath.Join(loja, "x.js")}, RSS: 99 * mb, Container: true},
		// Aberto por uma sessão do Claude: já está nas sessões.
		400: {PID: 400, PPID: 60, Comm: "claude", RSS: 200 * mb},
		401: {PID: 401, PPID: 400, Comm: "MainThread", Argv: []string{"node", filepath.Join(loja, "node_modules/.bin/eslint")}, RSS: 900 * mb},
		// Serviço do systemd que roda de dentro de ~/projetos (ex.: o ajudante do painel).
		500: {PID: 500, PPID: 50, Comm: "python3", Argv: []string{"python3", filepath.Join(root, "painel/helper/ajudante.py")}, RSS: 20 * mb, Unit: "ajudante.service"},
		// Pasta sem projeto no painel.
		600: {PID: 600, PPID: 60, Comm: "node", Argv: []string{"node", filepath.Join(root, "rascunho/server.js")}, RSS: 40 * mb},
	}
	projects := []model.Project{{Key: "loja", Name: "Loja", Dir: loja}}
	runs := Find(procs, projects, root, home)
	if len(runs) != 3 {
		t.Fatalf("esperava 3 servidores, veio %d: %+v", len(runs), runs)
	}
	byPID := map[int]Run{}
	for _, r := range runs {
		byPID[r.PID] = r
	}
	r := byPID[100]
	if r.ProjectKey != "loja" || r.Worktree != "feature" || r.Dir != "~/projetos/loja-wt/feature" || !r.Orphan || r.MemUsed != 541*mb || r.Procs != 4 || r.Start != "777" {
		t.Errorf("worktree: %+v", r)
	}
	if r := byPID[200]; r.ProjectKey != "loja" || r.Worktree != "" || r.Orphan || r.Command != "nest start --watch" {
		t.Errorf("projeto: %+v", r)
	}
	if r := byPID[600]; r.ProjectKey != "" || r.ProjectName != "rascunho" || r.Dir != "~/projetos/rascunho" {
		t.Errorf("sem projeto: %+v", r)
	}
	if runs[0].PID != 100 {
		t.Errorf("ordem por memória: %+v", runs[0])
	}
}

func TestSiblingWorktree(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(home, "projetos")
	loja := filepath.Join(root, "loja")
	must(t, os.MkdirAll(filepath.Join(loja, ".git"), 0o755))
	procs := map[int]procfs.Proc{
		10: {PID: 10, PPID: 1, Comm: "node", Argv: []string{"node", filepath.Join(root, "loja-pix/server.js")}, RSS: mb},
	}
	runs := Find(procs, []model.Project{{Key: "loja", Name: "Loja", Dir: loja}}, root, home)
	if len(runs) != 1 || runs[0].ProjectKey != "loja" || runs[0].Worktree != "pix" || !runs[0].Orphan {
		t.Errorf("runs = %+v", runs)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
