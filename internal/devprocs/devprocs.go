// Package devprocs acha servidores de desenvolvimento rodando direto no computador, fora do Docker
// (npm run dev, next dev, nest start…), e liga cada um ao projeto e à worktree de onde vieram.
//
// O painel não pode ler a pasta atual de outro processo (/proc/<pid>/cwd), então a pasta vem dos
// caminhos na linha de comando: "node /home/u/projetos/loja-wt/feature/web/node_modules/.bin/next dev".
package devprocs

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"servermanager/internal/model"
	"servermanager/internal/procfs"
)

// Run é um servidor de desenvolvimento fora do Docker (veja model.DevRun).
type Run = model.DevRun

// Quem abre processos que não são servidores do projeto: o que roda abaixo deles fica de fora.
// claude: a memória já entra nas sessões. Editores e navegadores: servidores de linguagem e afins.
var owners = map[string]bool{"claude": true, "code": true, "cursor": true, "chrome": true, "firefox": true, "claude-desktop": true, "zed": true}

// Processos intermediários que fazem parte do servidor: sobe-se por eles até quem iniciou.
var launchers = map[string]bool{"npm": true, "npx": true, "pnpm": true, "yarn": true, "bun": true, "node": true, "MainThread": true, "tsx": true, "nodemon": true, "deno": true}

// Find devolve os servidores de desenvolvimento fora do Docker cujos arquivos estão em root (~/projetos).
func Find(procs map[int]procfs.Proc, projects []model.Project, root, home string) []Run {
	if root == "" || len(procs) == 0 {
		return []Run{}
	}
	root = filepath.Clean(root)
	children := map[int][]int{}
	for _, p := range procs {
		children[p.PPID] = append(children[p.PPID], p.PID)
	}

	// Fora: containers (já estão nos projetos) e tudo abaixo de sessões do Claude, editores e navegadores.
	skip := map[int]bool{}
	var mark func(pid int)
	mark = func(pid int) {
		if skip[pid] {
			return
		}
		skip[pid] = true
		for _, c := range children[pid] {
			mark(c)
		}
	}
	for _, p := range procs {
		// Serviços do systemd (ex.: o ajudante do painel) são de propósito: não são servidores esquecidos.
		if p.Container || owners[p.Comm] || strings.HasSuffix(p.Unit, ".service") {
			mark(p.PID)
		}
	}

	// Raiz de cada servidor: sobe a partir de cada processo com caminho em root enquanto o pai for
	// um intermediário (npm, node, "sh -c ..."). Para no terminal, no tmux ou no systemd.
	roots := map[int]string{} // raiz -> caminho usado para achar o projeto
	for _, p := range procs {
		if skip[p.PID] {
			continue
		}
		path := pathIn(p.Argv, root)
		if path == "" {
			continue
		}
		top := p.PID
		for {
			parent, ok := procs[procs[top].PPID]
			if !ok || skip[parent.PID] || !isLauncher(parent) {
				break
			}
			top = parent.PID
		}
		if _, ok := roots[top]; !ok {
			roots[top] = path
		}
	}

	// Um servidor aberto por outro (turbo -> next) já entra na soma de quem o abriu.
	for pid := range roots {
		for a := procs[pid].PPID; a > 1; a = procs[a].PPID {
			if _, ok := roots[a]; ok {
				delete(roots, pid)
				break
			}
			if _, ok := procs[a]; !ok {
				break
			}
		}
	}

	res := resolver{projects: projects, root: root, home: home}
	out := make([]Run, 0, len(roots))
	for pid, path := range roots {
		r := Run{PID: pid, Start: procs[pid].StartTime(), Command: shortCommand(procs, pid)}
		seen := map[string]bool{}
		stack := []int{pid}
		for len(stack) > 0 {
			q := procs[stack[len(stack)-1]]
			stack = stack[:len(stack)-1]
			if skip[q.PID] && q.PID != pid {
				continue
			}
			r.MemUsed += q.RSS
			r.SwapUsed += q.Swap
			r.Procs++
			if n := procfs.AppName(q); q.RSS > 0 && !seen[n] && n != "sh" && n != "bash" {
				seen[n] = true
				r.Programs = append(r.Programs, n)
			}
			stack = append(stack, children[q.PID]...)
		}
		parent := procs[procs[pid].PPID]
		r.Orphan = procs[pid].PPID <= 1 || parent.Comm == "systemd" || parent.Comm == "init"
		r.Dir, r.ProjectKey, r.ProjectName, r.Worktree = res.resolve(path)
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].MemUsed > out[j].MemUsed })
	return out
}

func isLauncher(p procfs.Proc) bool {
	if launchers[p.Comm] {
		return true
	}
	// "sh -c next dev": o shell que o npm abre. Um shell interativo (o do terminal) não entra.
	if (p.Comm == "sh" || p.Comm == "bash" || p.Comm == "dash" || p.Comm == "zsh") && len(p.Argv) > 1 && p.Argv[1] == "-c" {
		return true
	}
	return strings.HasPrefix(p.Comm, "npm ") || strings.HasPrefix(p.Comm, "next-server")
}

// pathIn devolve o primeiro caminho da linha de comando que fica dentro de root.
func pathIn(argv []string, root string) string {
	for _, a := range argv {
		if _, v, ok := strings.Cut(a, "="); ok && strings.HasPrefix(v, "/") {
			a = v // --config=/home/u/projetos/x
		}
		if !strings.HasPrefix(a, root+string(filepath.Separator)) {
			continue
		}
		return filepath.Clean(a)
	}
	return ""
}

// shortCommand descreve o servidor pelo primeiro processo que diz o que roda (next dev, nest start).
func shortCommand(procs map[int]procfs.Proc, pid int) string {
	p := procs[pid]
	args := p.Argv
	// "npm run dev" já diz tudo; para node, o que vem depois do script.
	if len(args) > 1 && (filepath.Base(args[0]) == "node" || p.Comm == "MainThread") {
		script := filepath.Base(args[1])
		args = append([]string{script}, args[2:]...)
	}
	s := strings.Join(args, " ")
	if len(s) > 80 {
		s = s[:77] + "…"
	}
	return s
}

type resolver struct {
	projects []model.Project
	root     string
	home     string
}

// resolve acha a pasta do servidor, o projeto e a worktree a partir de um caminho dentro de root.
func (r resolver) resolve(path string) (dir, key, name, worktree string) {
	rel, err := filepath.Rel(r.root, path)
	if err != nil || strings.HasPrefix(rel, "..") {
		return r.short(path), "", filepath.Base(path), ""
	}
	segs := strings.Split(rel, string(filepath.Separator))
	top := filepath.Join(r.root, segs[0])

	// 1. Dentro da pasta de um projeto do painel (a mais específica ganha).
	var best *model.Project
	for i := range r.projects {
		p := &r.projects[i]
		if p.Dir != "" && (path == p.Dir || strings.HasPrefix(path, p.Dir+string(filepath.Separator))) {
			if best == nil || len(p.Dir) > len(best.Dir) {
				best = p
			}
		}
	}
	if best != nil {
		if best.Worktree != nil {
			return r.short(best.Dir), best.Worktree.MainKey, best.Worktree.MainName, strings.TrimPrefix(filepath.Base(best.Dir), filepath.Base(best.Worktree.MainDir)+"-")
		}
		return r.short(best.Dir), best.Key, best.Name, ""
	}

	// 2. Worktree do git: o .git é um arquivo que aponta para <repo principal>/.git/.../worktrees/<nome>.
	for d := filepath.Dir(path); d != r.root && strings.HasPrefix(d, r.root); d = filepath.Dir(d) {
		main, ok := worktreeMain(d)
		if !ok {
			continue
		}
		if p := r.projectAt(main); p != nil {
			wt, wdir := worktreeLabel(segs, filepath.Base(p.Dir), r.root)
			return r.short(wdir), p.Key, p.Name, wt
		}
		break
	}

	// 3. Pasta irmã "<projeto>-algo" ou "<projeto>-wt/algo" sem git: worktree pelo nome.
	for i := range r.projects {
		p := &r.projects[i]
		if p.Dir == "" || p.Worktree != nil || filepath.Dir(p.Dir) != r.root {
			continue
		}
		base := filepath.Base(p.Dir)
		if strings.HasPrefix(segs[0], base+"-") {
			wt, wdir := worktreeLabel(segs, base, r.root)
			return r.short(wdir), p.Key, p.Name, wt
		}
	}

	// 4. Pasta sem projeto no painel.
	return r.short(top), "", segs[0], ""
}

// projectAt devolve o projeto cuja pasta é main, contém main ou fica dentro dela.
func (r resolver) projectAt(main string) *model.Project {
	var best *model.Project
	for i := range r.projects {
		p := &r.projects[i]
		if p.Dir == "" || p.Worktree != nil {
			continue
		}
		if p.Dir == main || strings.HasPrefix(main, p.Dir+string(filepath.Separator)) || strings.HasPrefix(p.Dir, main+string(filepath.Separator)) {
			if best == nil || len(p.Dir) > len(best.Dir) {
				best = p
			}
		}
	}
	return best
}

// worktreeLabel dá o nome da worktree e a pasta dela. Uma pasta que junta as worktrees
// ("loja-wt/feature/web") dá "feature"; uma pasta irmã ("loja-feature") dá "feature".
func worktreeLabel(segs []string, mainBase, root string) (string, string) {
	if len(segs) > 1 {
		switch strings.TrimPrefix(segs[0], mainBase) {
		case "-wt", "-worktrees", "-trees", ".worktrees", "_wt":
			return segs[1], filepath.Join(root, segs[0], segs[1])
		}
	}
	return strings.TrimPrefix(segs[0], mainBase+"-"), filepath.Join(root, segs[0])
}

// worktreeMain lê dir/.git; se for uma worktree, devolve a pasta do repositório principal.
func worktreeMain(dir string) (string, bool) {
	b, err := os.ReadFile(filepath.Join(dir, ".git"))
	if err != nil {
		return "", false
	}
	gitdir, ok := strings.CutPrefix(strings.TrimSpace(string(b)), "gitdir:")
	if !ok {
		return "", false
	}
	gitdir = strings.TrimSpace(gitdir)
	if !filepath.IsAbs(gitdir) {
		gitdir = filepath.Join(dir, gitdir)
	}
	sep := string(filepath.Separator)
	if !strings.Contains(gitdir, sep+"worktrees"+sep) {
		return "", false // submódulo comum
	}
	i := strings.Index(gitdir, sep+".git"+sep)
	if i < 0 {
		return "", false
	}
	return gitdir[:i], true
}

func (r resolver) short(p string) string {
	if r.home != "" && strings.HasPrefix(p, r.home+string(filepath.Separator)) {
		return "~" + p[len(r.home):]
	}
	return p
}
