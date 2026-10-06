package procfs

import (
	"path/filepath"
	"sort"
	"strings"
)

// App é um aplicativo com todos os seus processos somados.
type App struct {
	Name    string `json:"name"`
	MemUsed uint64 `json:"memUsed"`
	Procs   int    `json:"procs"`
}

// friendly traduz executáveis conhecidos para o nome que a pessoa reconhece.
var friendly = map[string]string{
	"chrome": "Google Chrome", "chromium": "Chromium", "firefox": "Firefox", "brave": "Brave",
	"code": "VS Code", "cursor": "Cursor", "zed": "Zed", "idea": "IntelliJ IDEA",
	"claude": "Claude Code", "codex": "Codex", "node": "Node.js", "next-server": "Next.js",
	"spotify": "Spotify", "slack": "Slack", "discord": "Discord", "telegram-desktop": "Telegram",
	"gnome-shell": "GNOME Shell", "Xwayland": "Xwayland", "snap-store": "Snap Store",
	"dockerd": "Docker", "containerd": "containerd", "mysqld": "MySQL", "mariadbd": "MariaDB",
	"postgres": "PostgreSQL", "redis-server": "Redis", "mongod": "MongoDB", "java": "Java",
	"python3": "Python", "python": "Python", "php-fpm": "PHP-FPM", "nginx": "nginx",
}

// AppName devolve o nome do aplicativo de um processo.
func AppName(p Proc) string {
	key := p.Comm
	if len(p.Argv) > 0 {
		a0 := p.Argv[0]
		// Processos que reescrevem o título ("postgres: checkpointer", "next-server (v16)"):
		// vale a primeira palavra.
		if i := strings.IndexAny(a0, " :("); i > 0 {
			a0 = a0[:i]
		}
		if b := filepath.Base(a0); b != "." && b != "/" && b != "" {
			key = b
		}
	}
	key = strings.TrimSuffix(key, ".exe")
	if n, ok := friendly[key]; ok {
		return n
	}
	return key
}

// TopApps agrupa os processos por aplicativo e devolve os n que mais usam memória,
// com o resto somado em "Outros".
func TopApps(procs map[int]Proc, n int) []App {
	by := map[string]*App{}
	for _, p := range procs {
		if p.RSS == 0 {
			continue // threads do kernel
		}
		name := AppName(p)
		a := by[name]
		if a == nil {
			a = &App{Name: name}
			by[name] = a
		}
		a.MemUsed += p.RSS
		a.Procs++
	}
	all := make([]App, 0, len(by))
	for _, a := range by {
		all = append(all, *a)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].MemUsed > all[j].MemUsed })
	if len(all) <= n {
		return all
	}
	rest := App{Name: "Outros"}
	for _, a := range all[n:] {
		rest.MemUsed += a.MemUsed
		rest.Procs += a.Procs
	}
	return append(all[:n:n], rest)
}
