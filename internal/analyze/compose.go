package analyze

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// composeNames são os arquivos que o `docker compose` lê sem -f.
var composeNames = []string{"compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"}

type composeFile struct {
	Path     string   // primeiro arquivo
	Files    []string // todos os arquivos usados, em ordem
	Reason   string   // por que estes arquivos
	Dir      string
	Project  string
	Services []composeService
	Missing  []string // variáveis obrigatórias sem valor
	EnvFiles []string // env_file declarados que não existem
	Others   []string // variantes (docker-compose.prod.yml...) ignoradas
	Err      error
}

type composeService struct {
	Name          string
	Image         string
	BuildContext  string // caminho absoluto, vazio sem build
	ContainerName string
	Ports         []composePort
	BindsSource   []string // pastas do projeto montadas no container
}

type composePort struct {
	Host      uint16
	Container uint16
}

var (
	varRef    = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)`)
	nameClean = regexp.MustCompile(`[^a-z0-9_-]+`)
)

var devVariant = regexp.MustCompile(`(?i)[.-](local|dev|development)\.ya?ml$`)

// findCompose escolhe, em cada pasta (raiz e até dois níveis abaixo), os arquivos compose de
// desenvolvimento: os que criaram os containers existentes, senão uma variante local/dev,
// senão o padrão com o override.
func findCompose(root string, inUse map[string]bool) []composeFile {
	var out []composeFile
	walk(root, 2, func(dir string) {
		all := composeFiles(dir)
		if len(all) == 0 {
			return
		}
		var chosen []string
		reason := ""
		for _, f := range all {
			if inUse[filepath.Join(dir, f)] {
				chosen = append(chosen, f)
			}
		}
		if len(chosen) > 0 {
			reason = "o arquivo usado pelos containers que já existem"
		}
		if len(chosen) == 0 {
			for _, f := range all {
				if devVariant.MatchString(f) {
					chosen, reason = []string{f}, "a variante de desenvolvimento"
					break
				}
			}
		}
		if len(chosen) == 0 {
			for _, n := range composeNames {
				if exists(filepath.Join(dir, n)) {
					chosen = []string{n}
					base := strings.TrimSuffix(strings.TrimSuffix(n, ".yml"), ".yaml")
					for _, ext := range []string{".yml", ".yaml"} {
						if exists(filepath.Join(dir, base+".override"+ext)) {
							chosen = append(chosen, base+".override"+ext)
						}
					}
					reason = "o arquivo padrão"
					break
				}
			}
		}
		if len(chosen) == 0 {
			return // só variantes de produção
		}
		paths := make([]string, len(chosen))
		for i, f := range chosen {
			paths[i] = filepath.Join(dir, f)
		}
		cf := parseCompose(paths)
		cf.Reason = reason
		used := map[string]bool{}
		for _, f := range chosen {
			used[f] = true
		}
		for _, f := range all {
			if !used[f] {
				cf.Others = append(cf.Others, f)
			}
		}
		out = append(out, cf)
	})
	return out
}

var composeFileName = regexp.MustCompile(`^(docker-)?compose([.-][\w.-]+)?\.ya?ml$`)

func composeFiles(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() && composeFileName.MatchString(e.Name()) {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out
}

func parseCompose(paths []string) composeFile {
	dir := filepath.Dir(paths[0])
	cf := composeFile{Path: paths[0], Files: paths, Dir: dir}
	env := readEnv(filepath.Join(dir, ".env"))
	if env == nil {
		env = map[string]string{}
	}
	byName := map[string]int{}
	seen := map[string]bool{}
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			cf.Err = err
			return cf
		}
		if err := parseOne(&cf, raw, env, seen, byName); err != nil {
			cf.Err = fmt.Errorf("%s: %w", filepath.Base(path), err)
			return cf
		}
	}
	sort.Strings(cf.Missing)
	if cf.Project == "" {
		cf.Project = projectName("", env, dir)
	}
	return cf
}

func parseOne(cf *composeFile, raw []byte, env map[string]string, seen map[string]bool, byName map[string]int) error {
	dir := cf.Dir

	// Variáveis sem valor padrão que o compose exige.
	text := strings.ReplaceAll(string(raw), "$$", "")
	for _, m := range varRef.FindAllStringSubmatch(text, -1) {
		name, op := m[1], m[2]
		if name == "" {
			name = m[4]
		}
		if _, ok := env[name]; ok || seen[name] {
			continue
		}
		if op == "" || strings.Contains(op, "?") {
			seen[name] = true
			cf.Missing = append(cf.Missing, name)
		}
	}
	var doc struct {
		Name     string               `yaml:"name"`
		Services map[string]yaml.Node `yaml:"services"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return err
	}
	if doc.Name != "" && cf.Project == "" {
		cf.Project = projectName(doc.Name, env, dir)
	}

	names := make([]string, 0, len(doc.Services))
	for n := range doc.Services {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		node := doc.Services[n]
		var s struct {
			Image         string    `yaml:"image"`
			Build         yaml.Node `yaml:"build"`
			ContainerName string    `yaml:"container_name"`
			Ports         []any     `yaml:"ports"`
			Volumes       []any     `yaml:"volumes"`
			EnvFile       yaml.Node `yaml:"env_file"`
		}
		if err := node.Decode(&s); err != nil {
			return fmt.Errorf("serviço %s: %w", n, err)
		}
		svc := composeService{Name: n, Image: interpolate(s.Image, env), ContainerName: interpolate(s.ContainerName, env)}
		switch s.Build.Kind {
		case yaml.ScalarNode:
			svc.BuildContext = filepath.Join(dir, interpolate(s.Build.Value, env))
		case yaml.MappingNode:
			var b struct {
				Context string `yaml:"context"`
			}
			_ = s.Build.Decode(&b)
			if b.Context == "" {
				b.Context = "."
			}
			svc.BuildContext = filepath.Join(dir, interpolate(b.Context, env))
		}
		for _, p := range s.Ports {
			if cp, ok := parsePort(p, env); ok {
				svc.Ports = append(svc.Ports, cp)
			}
		}
		for _, v := range s.Volumes {
			if src := bindSource(v, env, dir); src != "" {
				svc.BindsSource = append(svc.BindsSource, src)
			}
		}
		for _, f := range stringsOf(s.EnvFile) {
			p := filepath.Join(dir, interpolate(f, env))
			if !exists(p) {
				cf.EnvFiles = append(cf.EnvFiles, p)
			}
		}
		if i, ok := byName[n]; ok {
			// O arquivo seguinte sobrescreve o serviço; mantém o que ele não redefine.
			old := cf.Services[i]
			if svc.Image == "" {
				svc.Image = old.Image
			}
			if svc.BuildContext == "" {
				svc.BuildContext = old.BuildContext
			}
			if svc.ContainerName == "" {
				svc.ContainerName = old.ContainerName
			}
			if len(svc.Ports) == 0 {
				svc.Ports = old.Ports
			}
			svc.BindsSource = append(old.BindsSource, svc.BindsSource...)
			cf.Services[i] = svc
			continue
		}
		byName[n] = len(cf.Services)
		cf.Services = append(cf.Services, svc)
	}
	return nil
}

// projectName segue a regra do compose: name:, COMPOSE_PROJECT_NAME ou o nome da pasta.
func projectName(name string, env map[string]string, dir string) string {
	if name == "" {
		name = env["COMPOSE_PROJECT_NAME"]
	}
	if name == "" {
		name = filepath.Base(dir)
	}
	return nameClean.ReplaceAllString(strings.ToLower(name), "")
}

func interpolate(s string, env map[string]string) string {
	return varRef.ReplaceAllStringFunc(s, func(m string) string {
		sm := varRef.FindStringSubmatch(m)
		name, op, def := sm[1], sm[2], sm[3]
		if name == "" {
			name = sm[4]
		}
		v, ok := env[name]
		if strings.HasPrefix(op, ":-") && (!ok || v == "") || op == "-" && !ok {
			return def
		}
		return v
	})
}

func parsePort(p any, env map[string]string) (composePort, bool) {
	switch v := p.(type) {
	case string:
		s := interpolate(v, env)
		s, _, _ = strings.Cut(s, "/")
		parts := strings.Split(s, ":")
		if len(parts) < 2 {
			return composePort{}, false // só a porta do container: o Docker escolhe a do host
		}
		host, ctr := parts[len(parts)-2], parts[len(parts)-1]
		h, err1 := strconv.ParseUint(host, 10, 16)
		c, err2 := strconv.ParseUint(ctr, 10, 16)
		if err1 != nil || err2 != nil || h == 0 {
			return composePort{}, false
		}
		return composePort{Host: uint16(h), Container: uint16(c)}, true
	case int:
		return composePort{}, false
	case map[string]any:
		h, _ := strconv.ParseUint(interpolate(fmt.Sprint(v["published"]), env), 10, 16)
		c, _ := strconv.ParseUint(fmt.Sprint(v["target"]), 10, 16)
		if h == 0 {
			return composePort{}, false
		}
		return composePort{Host: uint16(h), Container: uint16(c)}, true
	}
	return composePort{}, false
}

// bindSource devolve a pasta do projeto montada por um volume, ou "" se não for bind do projeto.
func bindSource(v any, env map[string]string, dir string) string {
	var src string
	switch x := v.(type) {
	case string:
		s := interpolate(x, env)
		src, _, _ = strings.Cut(s, ":")
	case map[string]any:
		if fmt.Sprint(x["type"]) != "bind" {
			return ""
		}
		src = interpolate(fmt.Sprint(x["source"]), env)
	}
	if !strings.HasPrefix(src, ".") {
		return ""
	}
	return filepath.Join(dir, src)
}

func stringsOf(n yaml.Node) []string {
	switch n.Kind {
	case yaml.ScalarNode:
		return []string{n.Value}
	case yaml.SequenceNode:
		var out []string
		for _, c := range n.Content {
			if c.Kind == yaml.ScalarNode {
				out = append(out, c.Value)
			} else {
				var m struct {
					Path     string `yaml:"path"`
					Required *bool  `yaml:"required"`
				}
				if c.Decode(&m) == nil && (m.Required == nil || *m.Required) && m.Path != "" {
					out = append(out, m.Path)
				}
			}
		}
		return out
	}
	return nil
}

var skipDirs = map[string]bool{"node_modules": true, ".git": true, ".next": true, "dist": true, "build": true, "vendor": true, ".turbo": true, "coverage": true, "storage": true, "bkp": true, "backup": true}

// walk visita a pasta e as subpastas até depth níveis, pulando pastas geradas.
func walk(dir string, depth int, fn func(string)) {
	fn(dir)
	if depth == 0 {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() && !skipDirs[e.Name()] && !strings.HasPrefix(e.Name(), ".") {
			walk(filepath.Join(dir, e.Name()), depth-1, fn)
		}
	}
}
