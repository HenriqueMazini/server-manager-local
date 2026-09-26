package analyze

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// devScripts são os nomes de script de desenvolvimento, em ordem de preferência.
var devScripts = []string{"dev", "start:dev", "develop", "serve", "watch"}

// orchestrators rodam vários pacotes de uma vez; nesse caso os apps são os pacotes filhos.
var orchestrator = regexp.MustCompile(`\b(turbo|nx|lerna|concurrently|npm-run-all|run-p|pnpm\s+(-r|--recursive|--filter)|yarn\s+workspaces)\b`)

type nodeApp struct {
	Dir         string
	Name        string // nome do pacote
	Script      string
	Command     string
	Manager     string // npm | pnpm | yarn
	Port        uint16
	PortSource  string // explicit | code | default | ""
	PortWhere   string
	NodeMajor   int // 0 = sem exigência
	NodeWhere   string
	HasModules  bool
	Deps        map[string]bool
	Orchestrate bool
}

type pkgJSON struct {
	Name            string            `json:"name"`
	Scripts         map[string]string `json:"scripts"`
	Engines         map[string]string `json:"engines"`
	PackageManager  string            `json:"packageManager"`
	Dependencies    map[string]string `json:"dependencies"`
	DevDependencies map[string]string `json:"devDependencies"`
	Workspaces      json.RawMessage   `json:"workspaces"`
}

var (
	flagPort  = regexp.MustCompile(`(?:--port[= ]|-p\s+|PORT=)(\d{2,5})\b`)
	listenLit = regexp.MustCompile(`listen\(\s*(?:[\w.]*PORT[\w.]*\s*(?:\|\||\?\?)\s*)?['"]?(\d{2,5})['"]?`)
	portEnvOr = regexp.MustCompile(`PORT\s*(?:\|\||\?\?)\s*['"]?(\d{2,5})`)
	cfgPort   = regexp.MustCompile(`\bport\s*:\s*(\d{2,5})`)
	nodeVer   = regexp.MustCompile(`(\d+)`)
)

// findNodeApps acha pacotes com script de desenvolvimento na raiz e até dois níveis abaixo.
func findNodeApps(root string) []nodeApp {
	var out []nodeApp
	rootMods := exists(filepath.Join(root, "node_modules"))
	walk(root, 2, func(dir string) {
		raw, err := os.ReadFile(filepath.Join(dir, "package.json"))
		if err != nil {
			return
		}
		var pkg pkgJSON
		if json.Unmarshal(raw, &pkg) != nil {
			return
		}
		script := ""
		for _, s := range devScripts {
			if pkg.Scripts[s] != "" {
				script = s
				break
			}
		}
		if script == "" {
			return
		}
		app := nodeApp{Dir: dir, Name: pkg.Name, Script: script, Deps: map[string]bool{}}
		for d := range pkg.Dependencies {
			app.Deps[d] = true
		}
		for d := range pkg.DevDependencies {
			app.Deps[d] = true
		}
		app.Orchestrate = orchestrator.MatchString(pkg.Scripts[script])
		app.Manager = manager(dir, root, pkg.PackageManager)
		app.Command = app.Manager + " run " + script
		if app.Manager == "pnpm" || app.Manager == "yarn" {
			app.Command = "corepack " + app.Command
		}
		app.HasModules = exists(filepath.Join(dir, "node_modules")) || rootMods
		app.NodeMajor, app.NodeWhere = nodeRequirement(dir, root, pkg.Engines["node"])
		detectPort(&app, pkg.Scripts[script])
		out = append(out, app)
	})
	// Monorepo com orquestrador na raiz: os apps são os pacotes filhos.
	if len(out) > 1 && out[0].Dir == root && out[0].Orchestrate {
		out = out[1:]
	}
	return out
}

func manager(dir, root, declared string) string {
	switch {
	case strings.HasPrefix(declared, "pnpm"):
		return "pnpm"
	case strings.HasPrefix(declared, "yarn"):
		return "yarn"
	}
	for _, d := range []string{dir, root} {
		if exists(filepath.Join(d, "pnpm-lock.yaml")) {
			return "pnpm"
		}
		if exists(filepath.Join(d, "yarn.lock")) {
			return "yarn"
		}
	}
	return "npm"
}

// nodeRequirement devolve a versão maior exigida (0 quando qualquer versão recente serve).
func nodeRequirement(dir, root, engines string) (int, string) {
	for _, d := range []string{dir, root} {
		for _, f := range []string{".nvmrc", ".node-version"} {
			if b, err := os.ReadFile(filepath.Join(d, f)); err == nil {
				if m := nodeVer.FindString(string(b)); m != "" {
					n, _ := strconv.Atoi(m)
					return n, f
				}
			}
		}
	}
	e := strings.TrimSpace(engines)
	if e == "" || strings.HasPrefix(e, ">") || e == "*" {
		return 0, "" // mínimo: o Node 24 atende
	}
	if m := nodeVer.FindString(e); m != "" {
		n, _ := strconv.Atoi(m)
		return n, "engines.node"
	}
	return 0, ""
}

func detectPort(app *nodeApp, script string) {
	set := func(p string, src, where string) bool {
		n, err := strconv.ParseUint(p, 10, 16)
		if err != nil || n == 0 {
			return false
		}
		app.Port, app.PortSource, app.PortWhere = uint16(n), src, where
		return true
	}
	if m := flagPort.FindStringSubmatch(script); m != nil && set(m[1], "explicit", "script "+app.Script) {
		return
	}
	env, files := dirEnv(app.Dir)
	if v := env["PORT"]; v != "" {
		where := ".env"
		for _, f := range files {
			if f.Vars["PORT"] != "" {
				where = filepath.Base(f.Path)
			}
		}
		if set(v, "explicit", where) {
			return
		}
	}
	for _, f := range []string{"src/main.ts", "src/main.js", "src/server.ts", "src/server.js", "server.js", "src/index.ts", "index.js"} {
		b, err := os.ReadFile(filepath.Join(app.Dir, f))
		if err != nil {
			continue
		}
		if m := portEnvOr.FindSubmatch(b); m != nil && set(string(m[1]), "code", f) {
			return
		}
		if m := listenLit.FindSubmatch(b); m != nil && set(string(m[1]), "code", f) {
			return
		}
	}
	for _, f := range []string{"vite.config.ts", "vite.config.js", "vite.config.mts", "angular.json", "nuxt.config.ts"} {
		if b, err := os.ReadFile(filepath.Join(app.Dir, f)); err == nil {
			if m := cfgPort.FindSubmatch(b); m != nil && set(string(m[1]), "explicit", f) {
				return
			}
		}
	}
	defaults := []struct {
		dep  string
		port string
	}{{"next", "3000"}, {"nuxt", "3000"}, {"@remix-run/dev", "3000"}, {"vite", "5173"}, {"@angular/cli", "4200"}, {"@nestjs/core", "3000"}, {"express", "3000"}}
	for _, d := range defaults {
		if app.Deps[d.dep] && set(d.port, "default", "padrão do "+d.dep) {
			return
		}
	}
}
