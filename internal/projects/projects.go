// Package projects monta os projetos do painel: containers de infraestrutura e apps de desenvolvimento.
package projects

import (
	"fmt"
	"os"
	"regexp"
	"sort"

	"servermanager/internal/config"
	"servermanager/internal/dockerx"
	"servermanager/internal/model"
)

// Padrões dos apps, ajustáveis por variável de ambiente.
var (
	AppImage = envOr("SM_APP_IMAGE", "node:24-bookworm-slim")
	AppUser  = envOr("SM_APP_USER", "1000:1000")
)

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

var unsafeName = regexp.MustCompile(`[^a-zA-Z0-9_.-]+`)

// AppContainerName é o nome do container que o painel cria para um app.
func AppContainerName(project, app string) string {
	return "sm-" + unsafeName.ReplaceAllString(project, "-") + "-" + unsafeName.ReplaceAllString(app, "-")
}

// Spec monta o container de um app a partir do services.yml.
func Spec(key string, p config.ProjectCfg, a config.AppCfg) dockerx.AppSpec {
	root := config.ExpandPath(p.Dir, "")
	dir := config.ExpandPath(a.Dir, root)
	mountDir := root
	if mountDir == "" {
		mountDir = dir
	}
	image := a.Image
	if image == "" {
		image = AppImage
	}
	env := []string{"HOME=/tmp", "NEXT_TELEMETRY_DISABLED=1", "npm_config_update_notifier=false", "TERM=xterm-256color"}
	keys := make([]string, 0, len(a.Env))
	for k := range a.Env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		env = append(env, k+"="+a.Env[k])
	}
	if a.Port != 0 {
		env = append(env, fmt.Sprintf("PORT=%d", a.Port))
	}
	return dockerx.AppSpec{
		Name:       AppContainerName(key, a.Key),
		Project:    key,
		Key:        a.Key,
		Image:      image,
		User:       AppUser,
		Command:    a.Command,
		WorkDir:    dir,
		MountDir:   mountDir,
		Env:        env,
		StopSecond: 10,
	}
}

type builder struct {
	cfg       config.Config
	mem       map[string]dockerx.Mem
	listening map[uint16]bool
	byKey     map[string]*model.Project
	all       []model.Container
	hidden    map[string]bool
}

// Build agrupa tudo em projetos. Devolve os projetos visíveis e todos os itens
// (inclusive ocultos e apps nunca ligados), porque todos reservam portas.
func Build(infos []dockerx.Info, mem map[string]dockerx.Mem, listeners []model.HostListener, cfg config.Config) ([]model.Project, []model.Container) {
	b := &builder{cfg: cfg, mem: mem, listening: map[uint16]bool{}, byKey: map[string]*model.Project{}, hidden: map[string]bool{}}
	for _, l := range listeners {
		if l.Proto == "tcp" {
			b.listening[l.Port] = true
		}
	}
	for _, h := range cfg.Hide {
		b.hidden[h] = true
	}

	composeOwner := map[string]string{}
	containerOwner := map[string]string{}
	for key, p := range cfg.Projects {
		for _, c := range p.Compose {
			composeOwner[c] = key
		}
		for _, c := range p.Containers {
			containerOwner[c] = key
		}
		b.project(key, "configured")
	}

	apps := map[string]dockerx.Info{} // nome do container -> info
	for _, in := range infos {
		if in.Labels[dockerx.LabelSelf] == "true" {
			continue
		}
		if in.Labels[dockerx.LabelAppProject] != "" {
			apps[in.Name] = in
			continue
		}
		key, kind := in.Name, "standalone"
		if cp := in.Labels[dockerx.LabelProject]; cp != "" {
			key, kind = cp, "compose"
			if owner, ok := composeOwner[cp]; ok {
				key, kind = owner, "configured"
			}
		}
		if owner, ok := containerOwner[in.Name]; ok {
			key, kind = owner, "configured"
		}
		b.addInfra(key, kind, in)
	}

	for key, p := range cfg.Projects {
		for _, a := range p.Apps {
			spec := Spec(key, p, a)
			in, exists := apps[spec.Name]
			delete(apps, spec.Name)
			b.addApp(key, a, spec, in, exists)
		}
	}
	// Apps que saíram do services.yml mas ainda existem: aparecem soltos para poderem ser desligados.
	for _, in := range apps {
		b.addInfra(in.Name, "standalone", in)
	}

	out := make([]model.Project, 0, len(b.byKey))
	for key, p := range b.byKey {
		finish(p)
		if b.hidden[key] || p.Total == 0 {
			continue
		}
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool {
		if (out[i].Kind == "configured") != (out[j].Kind == "configured") {
			return out[i].Kind == "configured"
		}
		return out[i].Name < out[j].Name
	})
	return out, b.all
}

func (b *builder) project(key, kind string) *model.Project {
	if p, ok := b.byKey[key]; ok {
		return p
	}
	p := &model.Project{Key: key, Name: key, Kind: kind, Links: []model.Link{}, Apps: []model.Container{}, Infra: []model.Container{}, Warnings: []string{}}
	if pc, ok := b.cfg.Projects[key]; ok {
		p.Kind = "configured"
		if pc.Name != "" {
			p.Name = pc.Name
		}
		p.Dir = config.ExpandPath(pc.Dir, "")
	}
	b.byKey[key] = p
	return p
}

func (b *builder) addInfra(key, kind string, in dockerx.Info) {
	p := b.project(key, kind)
	c := model.Container{
		ID:             in.ID,
		Name:           in.Name,
		Label:          in.Name,
		Role:           "infra",
		Image:          in.Image,
		State:          in.State,
		Status:         in.Status,
		Health:         in.Health,
		Running:        in.Running,
		Exists:         true,
		ProjectKey:     p.Key,
		ProjectName:    p.Name,
		ComposeProject: in.Labels[dockerx.LabelProject],
		ComposeService: in.Labels[dockerx.LabelService],
		WorkingDir:     in.Labels[dockerx.LabelWorkingDir],
		ConfigFiles:    in.Labels[dockerx.LabelConfigFiles],
		Ports:          []model.Port{},
	}
	if c.ComposeService != "" {
		c.Label = c.ComposeService
	}
	for _, bd := range in.Bindings {
		c.Ports = append(c.Ports, model.Port{
			HostIP: bd.HostIP, HostPort: bd.HostPort, ContainerPort: bd.ContainerPort, Proto: bd.Proto,
			URL: URLFor(in.Image, bd.HostIP, bd.HostPort, bd.ContainerPort, bd.Proto),
		})
	}
	if m, ok := b.mem[in.ID]; ok && in.Running {
		c.MemUsed, c.MemLimit = m.Used, m.Limit
	}
	b.all = append(b.all, c)
	if b.hidden[in.Name] || (c.ComposeProject != "" && b.hidden[c.ComposeProject]) {
		return
	}
	if p.Dir == "" {
		p.Dir = c.WorkingDir
	}
	p.Infra = append(p.Infra, c)
}

func (b *builder) addApp(key string, a config.AppCfg, spec dockerx.AppSpec, in dockerx.Info, exists bool) {
	p := b.project(key, "configured")
	name := a.Name
	if name == "" {
		name = a.Key
	}
	c := model.Container{
		ID:          "app:" + key + "/" + a.Key,
		Name:        spec.Name,
		Label:       name,
		Role:        "app",
		Image:       spec.Image,
		State:       "exited",
		Exists:      exists,
		ProjectKey:  key,
		ProjectName: p.Name,
		Command:     a.Command,
		AppDir:      spec.WorkDir,
		Ports:       []model.Port{},
	}
	if exists {
		c.ID, c.State, c.Status, c.Running = in.ID, in.State, in.Status, in.Running
		if m, ok := b.mem[in.ID]; ok && in.Running {
			c.MemUsed, c.MemLimit = m.Used, m.Limit
		}
	}
	if a.Port != 0 {
		url := a.URL
		if url == "" {
			url = fmt.Sprintf("http://localhost:%d", a.Port)
		}
		c.Ports = append(c.Ports, model.Port{HostPort: a.Port, ContainerPort: a.Port, Proto: "tcp", URL: url})
		c.Listening = c.Running && b.listening[a.Port]
		c.External = !c.Running && b.listening[a.Port]
	}
	b.all = append(b.all, c)
	p.Apps = append(p.Apps, c)
	if c.External {
		p.Warnings = append(p.Warnings, fmt.Sprintf("A porta %d (%s) já está em uso fora do painel. Feche o processo que usa essa porta, como um npm run dev aberto no terminal, antes de ligar.", a.Port, name))
	}
}

func finish(p *model.Project) {
	sort.SliceStable(p.Infra, func(i, j int) bool {
		a, b := p.Infra[i], p.Infra[j]
		if a.ComposeProject != b.ComposeProject {
			return a.ComposeProject < b.ComposeProject // avulsos (ex.: bancos de dev) antes do compose
		}
		return a.Label < b.Label
	})
	starting := false
	for _, list := range [][]model.Container{p.Apps, p.Infra} {
		for _, c := range list {
			p.Total++
			if c.Running {
				p.Running++
				p.MemUsed += c.MemUsed
			}
			if c.Role == "app" && c.Running && len(c.Ports) > 0 && !c.Listening {
				starting = true
			}
			if c.Health == "starting" {
				starting = true
			}
		}
	}
	switch {
	case p.Running == 0:
		p.State = "off"
	case p.Running < p.Total:
		p.State = "partial"
	case starting:
		p.State = "starting"
	default:
		p.State = "on"
	}
	for _, a := range p.Apps {
		for _, pt := range a.Ports {
			if IsWebURL(pt.URL) {
				p.Links = append(p.Links, model.Link{Label: a.Label, URL: pt.URL})
			}
		}
	}
	if len(p.Links) == 0 {
		for _, c := range p.Infra {
			for _, pt := range c.Ports {
				if IsWebURL(pt.URL) {
					p.Links = append(p.Links, model.Link{Label: c.Label, URL: pt.URL})
				}
			}
		}
	}
}
