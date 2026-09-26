// Package analyze inspeciona a pasta de um projeto, só lendo arquivos, e lista o que falta
// para o Server Manager criar o ambiente dele. Cada pendência traz um prompt para o Claude do projeto.
package analyze

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"servermanager/internal/config"
	"servermanager/internal/model"
	"servermanager/internal/ports"
)

// Status de cada requisito.
const (
	OK   = "ok"   // atendido
	Fail = "fail" // impede a criação
	Warn = "warn" // funciona, mas precisa de atenção
	Info = "info" // informativo
)

// Check é uma linha do modal.
type Check struct {
	Group  string   `json:"group"`
	Title  string   `json:"title"`
	Status string   `json:"status"`
	Detail string   `json:"detail,omitempty"`
	Items  []string `json:"items,omitempty"`
	Prompt string   `json:"prompt,omitempty"`
}

// Result é a análise completa.
type Result struct {
	Dir        string         `json:"dir"`
	DisplayDir string         `json:"displayDir"`
	Key        string         `json:"key"`
	Name       string         `json:"name"`
	Registered string         `json:"registered,omitempty"`
	Checks     []Check        `json:"checks"`
	Summary    map[string]int `json:"summary"`
	Ready      bool           `json:"ready"`
	Proposal   string         `json:"proposal"`
	AllPrompts string         `json:"allPrompts,omitempty"`
}

// ErrInput é um caminho inválido informado pelo usuário.
var ErrInput = errors.New("caminho inválido")

// Groups na ordem em que aparecem.
var Groups = []string{"Pasta", "Infraestrutura", "Apps", "Portas", "Segurança", "Preparação"}

type analysis struct {
	root, dir string
	snap      model.Snapshot
	cfg       config.Config
	composes  []composeFile
	apps      []nodeApp // apps que o painel vai rodar
	inCompose map[string]string
	excluded  map[string]string // "arquivo/serviço" -> motivo
	checks    []Check
	contains  []string // containers avulsos usados
	localSvc  map[string]bool
	refPorts  []uint16 // portas citadas nos .env do projeto
}

// Resolve valida o caminho e devolve a pasta absoluta dentro de root.
func Resolve(input, root string) (string, error) {
	p := strings.TrimSpace(input)
	if p == "" {
		return "", fmt.Errorf("%w: informe a pasta do projeto", ErrInput)
	}
	p = config.ExpandPath(p, root)
	if real, err := filepath.EvalSymlinks(p); err == nil {
		p = real
	}
	if root != "" && p == filepath.Clean(root) {
		return "", fmt.Errorf("%w: escolha a pasta de um projeto dentro de %s", ErrInput, display(root))
	}
	if root != "" && !strings.HasPrefix(p, filepath.Clean(root)+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: a pasta precisa estar dentro de %s", ErrInput, display(root))
	}
	st, err := os.Stat(p)
	if err != nil {
		return "", fmt.Errorf("%w: %s não existe ou não pode ser lida", ErrInput, display(p))
	}
	if !st.IsDir() {
		return "", fmt.Errorf("%w: %s não é uma pasta", ErrInput, display(p))
	}
	return p, nil
}

// Run analisa a pasta. snap e cfg são o estado atual do painel.
func Run(input, root string, snap model.Snapshot, cfg config.Config) (Result, error) {
	dir, err := Resolve(input, root)
	if err != nil {
		return Result{}, err
	}
	a := &analysis{root: root, dir: dir, snap: snap, cfg: cfg, inCompose: map[string]string{}, excluded: map[string]string{}, localSvc: map[string]bool{}}
	res := Result{Dir: dir, DisplayDir: display(dir)}
	res.Key, res.Name = defaultKey(dir), filepath.Base(dir)
	for key, p := range cfg.Projects {
		if config.ExpandPath(p.Dir, "") == dir {
			res.Registered, res.Key = key, key
			if p.Name != "" {
				res.Name = p.Name
			}
		}
	}

	inUse := map[string]bool{}
	for _, p := range snap.Projects {
		for _, c := range p.Infra {
			for _, f := range strings.Split(c.ConfigFiles, ",") {
				if f = strings.TrimSpace(f); f != "" {
					inUse[f] = true
				}
			}
		}
	}
	a.composes = findCompose(dir, inUse)
	for _, cf := range a.composes {
		for _, s := range cf.Services {
			a.localSvc[s.Name] = true
			if s.ContainerName != "" {
				a.localSvc[s.ContainerName] = true
			}
		}
	}
	a.classify(findNodeApps(dir))

	a.add(Check{Group: "Pasta", Title: "Pasta do projeto", Status: OK, Detail: display(dir)})
	if res.Registered != "" {
		a.add(Check{Group: "Pasta", Title: "Projeto já cadastrado", Status: Warn,
			Detail: fmt.Sprintf("Já existe no painel como \"%s\". A criação vai atualizar esse cadastro.", res.Name)})
	}
	a.checkCompose()
	a.checkApps()
	a.checkEnvFiles()
	a.checkReferencedInfra()
	a.checkPorts(res.Registered)
	a.checkSecurity()
	a.checkPreparation()

	res.Checks = a.checks
	res.Summary = map[string]int{OK: 0, Fail: 0, Warn: 0, Info: 0}
	var prompts []string
	for _, c := range a.checks {
		res.Summary[c.Status]++
		if c.Prompt != "" && (c.Status == Fail || c.Status == Warn) {
			prompts = append(prompts, c.Title+"\n"+c.Prompt)
		}
	}
	res.Ready = res.Summary[Fail] == 0
	res.AllPrompts = combine(dir, prompts)
	res.Proposal = a.proposal(res.Key, res.Name)
	WithContext(&res)
	return res, nil
}

func (a *analysis) add(c Check) { a.checks = append(a.checks, c) }

func (a *analysis) rel(p string) string {
	r, err := filepath.Rel(a.dir, p)
	if err != nil || r == "." {
		return "."
	}
	return r
}

// classify separa apps que rodam no compose (a pasta do código é montada num serviço)
// dos que o painel vai rodar, e marca serviços do compose que só empacotam um app para produção.
func (a *analysis) classify(apps []nodeApp) {
	for _, app := range apps {
		runner, best := "", -1
		for _, cf := range a.composes {
			for _, s := range cf.Services {
				for _, src := range s.BindsSource {
					if app.Dir != src && !strings.HasPrefix(app.Dir, src+string(filepath.Separator)) {
						continue
					}
					// Pasta mais específica ganha; depois, quem publica a porta do app; depois, quem publica alguma porta.
					score := len(src) * 4
					for _, p := range s.Ports {
						if app.Port != 0 && p.Host == app.Port {
							score += 2
						}
					}
					if len(s.Ports) > 0 {
						score++
					}
					if score > best {
						runner, best = s.Name, score
					}
				}
			}
		}
		if runner != "" {
			a.inCompose[a.rel(app.Dir)] = runner
			continue
		}
		a.apps = append(a.apps, app)
	}
	for _, cf := range a.composes {
		for _, s := range cf.Services {
			if s.BuildContext == "" {
				continue
			}
			for _, app := range a.apps {
				samePort := false
				for _, p := range s.Ports {
					samePort = samePort || (app.Port != 0 && p.Host == app.Port)
				}
				if s.BuildContext == app.Dir || samePort {
					a.excluded[cf.Path+"/"+s.Name] = fmt.Sprintf("empacota o app %s para produção; em desenvolvimento ele roda com %s", a.rel(app.Dir), app.Command)
				}
			}
		}
	}
}

func (a *analysis) checkCompose() {
	if len(a.composes) == 0 {
		a.add(Check{Group: "Infraestrutura", Title: "Docker Compose", Status: Info,
			Detail: "Nenhum docker-compose encontrado. Se o projeto usa banco, cache ou fila, eles precisam estar declarados num compose."})
		return
	}
	for _, cf := range a.composes {
		var names []string
		for _, f := range cf.Files {
			names = append(names, a.rel(f))
		}
		file := strings.Join(names, " + ")
		if cf.Err != nil {
			a.add(Check{Group: "Infraestrutura", Title: "Ler " + file, Status: Fail, Detail: cf.Err.Error(),
				Prompt: fmt.Sprintf("O arquivo %s não pôde ser interpretado (%s). Corrija a sintaxe do arquivo sem mudar o que ele sobe e confirme com `docker compose -f %s config`.", file, cf.Err, file)})
			continue
		}
		var items []string
		for _, s := range cf.Services {
			line := s.Name
			if s.Image != "" {
				line += " · " + s.Image
			} else if s.BuildContext != "" {
				line += " · build " + a.rel(s.BuildContext)
			}
			for _, p := range s.Ports {
				line += fmt.Sprintf(" · :%d", p.Host)
			}
			if why, ok := a.excluded[cf.Path+"/"+s.Name]; ok {
				line += " — não será criado: " + why
			}
			items = append(items, line)
		}
		a.add(Check{Group: "Infraestrutura", Title: fmt.Sprintf("Compose %s (projeto \"%s\")", file, cf.Project), Status: OK,
			Detail: fmt.Sprintf("%d serviços. Escolhido por ser %s.", len(cf.Services), cf.Reason), Items: items})
		if len(cf.Others) > 0 {
			a.add(Check{Group: "Infraestrutura", Title: "Outros arquivos compose", Status: Info,
				Detail: "Ignorados pelo painel em " + a.rel(cf.Dir) + ": " + strings.Join(cf.Others, ", ") + "."})
		}
		if len(cf.Missing) > 0 {
			envPath := filepath.Join(a.rel(cf.Dir), ".env")
			a.add(Check{Group: "Infraestrutura", Title: "Variáveis do " + file, Status: Fail,
				Detail: "O compose usa variáveis sem valor e sem padrão. Sem elas, os containers não são criados.",
				Items:  cf.Missing,
				Prompt: fmt.Sprintf("O %s usa estas variáveis sem valor definido e sem valor padrão: %s.\n"+
					"Defina valores de desenvolvimento para elas no %s (crie o arquivo se não existir), sem usar credenciais de produção. "+
					"Se uma variável só faz sentido em produção, use um padrão no próprio compose (${VAR:-valor}). "+
					"Atualize também o .env.example correspondente e confirme com `docker compose -f %s config` que não há mais avisos.",
					file, strings.Join(cf.Missing, ", "), envPath, file)})
		}
		if len(cf.EnvFiles) > 0 {
			var rels []string
			for _, p := range cf.EnvFiles {
				rels = append(rels, a.rel(p))
			}
			a.add(Check{Group: "Infraestrutura", Title: "Arquivos env_file do " + file, Status: Fail,
				Detail: "O compose aponta para arquivos que não existem.", Items: rels,
				Prompt: fmt.Sprintf("O %s declara env_file para arquivos que não existem: %s. Crie esses arquivos com valores de desenvolvimento (a partir do .example, se houver), sem credenciais de produção, ou marque-os como opcionais (required: false).", file, strings.Join(rels, ", "))})
		}
		var builds []string
		for _, s := range cf.Services {
			if s.BuildContext != "" && a.excluded[cf.Path+"/"+s.Name] == "" {
				builds = append(builds, s.Name)
			}
		}
		if len(builds) > 0 {
			a.add(Check{Group: "Infraestrutura", Title: "Imagens compiladas localmente", Status: Info,
				Detail: "Estes serviços usam build. A primeira criação compila as imagens e pode levar alguns minutos.", Items: builds})
		}
	}
}

func (a *analysis) checkApps() {
	rels := make([]string, 0, len(a.inCompose))
	for rel := range a.inCompose {
		rels = append(rels, rel)
	}
	sort.Strings(rels)
	for _, rel := range rels {
		svc := a.inCompose[rel]
		a.add(Check{Group: "Apps", Title: "App " + rel, Status: Info,
			Detail: fmt.Sprintf("Roda dentro do compose, no serviço \"%s\" (a pasta do código é montada no container). O painel não cria um app separado.", svc)})
	}
	if len(a.apps) == 0 {
		if len(a.inCompose) == 0 {
			a.add(Check{Group: "Apps", Title: "Apps de desenvolvimento", Status: Warn,
				Detail: "Nenhum package.json com script de desenvolvimento (dev, start:dev, develop, serve).",
				Prompt: "Não encontrei como este projeto roda em desenvolvimento. Descubra quais processos precisam ficar no ar para desenvolver (servidor web, API, workers), com o comando exato de cada um e a porta em que escutam. Se algum ainda não tem um script de desenvolvimento no package.json, crie. Me mostre a lista no fim."})
		}
		a.checkOtherStacks()
		return
	}
	for _, app := range a.apps {
		name := a.rel(app.Dir)
		prefix := "App " + name + ": "
		a.add(Check{Group: "Apps", Title: prefix + "script de desenvolvimento", Status: OK, Detail: app.Command})
		if app.Orchestrate {
			a.add(Check{Group: "Apps", Title: prefix + "orquestrador", Status: Warn,
				Detail: "O script sobe vários processos de uma vez (turbo, nx, concurrently...). O painel roda tudo num só container.",
				Prompt: fmt.Sprintf("O script \"%s\" em %s sobe vários processos de uma vez. Para o Server Manager, cada app precisa do próprio script de desenvolvimento. Crie um script dev em cada pacote que ainda não tiver, sem mudar o script da raiz, e me diga o comando e a porta de cada app.", app.Script, name)})
		}
		if app.HasModules {
			a.add(Check{Group: "Apps", Title: prefix + "dependências instaladas", Status: OK, Detail: "node_modules presente."})
		} else {
			install := app.Manager + " install"
			a.add(Check{Group: "Apps", Title: prefix + "dependências instaladas", Status: Fail,
				Detail: "Sem node_modules. O painel usa as dependências da pasta e não instala nada.",
				Prompt: fmt.Sprintf("Instale as dependências de %s com `%s`. Se a instalação exigir registro privado (.npmrc) ou alguma variável, configure e me explique o que foi preciso. Confirme que `%s` sobe sem erro e depois encerre o processo.", name, install, app.Command)})
		}
		switch app.PortSource {
		case "explicit":
			a.add(Check{Group: "Apps", Title: prefix + "porta", Status: OK, Detail: fmt.Sprintf("%d (em %s)", app.Port, app.PortWhere)})
		case "code", "default":
			a.add(Check{Group: "Apps", Title: prefix + "porta", Status: Warn,
				Detail: fmt.Sprintf("%d, presumida pelo %s. Sem porta declarada, uma mudança no framework troca a porta sem aviso.", app.Port, app.PortWhere),
				Prompt: fmt.Sprintf("A porta de desenvolvimento de %s não está declarada; hoje ela é %d por causa do %s. Declare a porta de forma explícita (variável PORT no .env e no .env.example, ou flag no script de desenvolvimento), mantendo %d, e garanta que o app respeita a variável PORT.", name, app.Port, app.PortWhere, app.Port)})
		default:
			a.add(Check{Group: "Apps", Title: prefix + "porta", Status: Fail,
				Detail: "Não consegui descobrir em que porta o app escuta.",
				Prompt: fmt.Sprintf("Descubra em que porta %s escuta quando roda `%s` e declare essa porta de forma explícita: variável PORT no .env e no .env.example, ou flag no script. Garanta que o app respeita a variável PORT. Me diga a porta final.", name, app.Command)})
		}
		if app.NodeMajor != 0 && app.NodeMajor != 24 {
			a.add(Check{Group: "Apps", Title: prefix + "versão do Node", Status: Info,
				Detail: fmt.Sprintf("Exige Node %d (%s). O app vai rodar na imagem node:%d-bookworm-slim.", app.NodeMajor, app.NodeWhere, app.NodeMajor)})
		} else {
			a.add(Check{Group: "Apps", Title: prefix + "versão do Node", Status: OK, Detail: "Node 24 atende."})
		}
		if app.Manager != "npm" {
			a.add(Check{Group: "Apps", Title: prefix + "gerenciador de pacotes", Status: Info,
				Detail: fmt.Sprintf("Usa %s. O container roda com corepack, que baixa o %s na primeira vez.", app.Manager, app.Manager)})
		}
	}
	a.checkOtherStacks()
}

// checkOtherStacks avisa sobre código que não é Node e não roda no compose.
func (a *analysis) checkOtherStacks() {
	markers := map[string]string{"composer.json": "PHP", "requirements.txt": "Python", "pyproject.toml": "Python", "go.mod": "Go", "Gemfile": "Ruby", "pom.xml": "Java", "Cargo.toml": "Rust"}
	var found []string
	walk(a.dir, 1, func(d string) {
		for f, lang := range markers {
			if exists(filepath.Join(d, f)) {
				rel := a.rel(d)
				covered := false
				for r := range a.inCompose {
					covered = covered || r == rel || strings.HasPrefix(rel, r+"/") || r == "."
				}
				for _, cf := range a.composes {
					for _, s := range cf.Services {
						for _, src := range s.BindsSource {
							covered = covered || d == src || strings.HasPrefix(d, src+string(filepath.Separator))
						}
					}
				}
				if !covered {
					found = append(found, fmt.Sprintf("%s (%s em %s)", lang, f, rel))
				}
			}
		}
	})
	if len(found) == 0 {
		return
	}
	sort.Strings(found)
	a.add(Check{Group: "Apps", Title: "Código que não é Node", Status: Warn,
		Detail: "O painel só roda apps Node sozinho. Estes precisam rodar num serviço do compose que monte a pasta do código.",
		Items:  found,
		Prompt: "Este projeto tem código que não é Node (" + strings.Join(found, "; ") + ") e que não roda em nenhum container de desenvolvimento. Para o Server Manager, ele precisa de um serviço no docker-compose que monte a pasta do código no container e suba o servidor de desenvolvimento com recarga automática. Crie ou ajuste esse serviço sem mexer na configuração de produção e me diga a porta."})
}

func (a *analysis) checkEnvFiles() {
	dirs := map[string]bool{a.dir: true}
	for _, app := range a.apps {
		dirs[app.Dir] = true
	}
	for _, cf := range a.composes {
		dirs[cf.Dir] = true
	}
	keys := make([]string, 0, len(dirs))
	for d := range dirs {
		keys = append(keys, d)
	}
	sort.Strings(keys)
	for _, d := range keys {
		example := ""
		for _, n := range []string{".env.example", ".env.sample", ".env.dist", ".env.local.example"} {
			if exists(filepath.Join(d, n)) {
				example = n
				break
			}
		}
		if example == "" {
			continue
		}
		_, files := dirEnv(d)
		rel := a.rel(d)
		if len(files) > 0 {
			a.add(Check{Group: "Apps", Title: "Arquivo .env em " + rel, Status: OK, Detail: filepath.Base(files[len(files)-1].Path) + " presente."})
			continue
		}
		a.add(Check{Group: "Apps", Title: "Arquivo .env em " + rel, Status: Fail,
			Detail: fmt.Sprintf("Existe %s, mas nenhum .env de desenvolvimento.", example),
			Prompt: fmt.Sprintf("Crie o arquivo de ambiente de desenvolvimento em %s a partir do %s. Use valores locais: bancos, cache e filas em localhost ou nos serviços do docker-compose deste projeto. Deixe vazias as chaves de serviços externos que enviam mensagens, e-mails ou cobranças, e desligue agendadores e crons. Me diga o que ficou pendente de valor.", rel, example)})
	}
}

var (
	urlSchemes   = map[string]uint16{"postgres": 5432, "postgresql": 5432, "mysql": 3306, "mariadb": 3306, "mongodb": 27017, "redis": 6379, "rediss": 6379, "amqp": 5672, "amqps": 5671}
	hostKey      = regexp.MustCompile(`^(.*?)_?HOST$`)
	sensitiveKey = regexp.MustCompile(`(?i)(STRIPE|MERCADO_?PAGO|^MP_|PAGSEGURO|PAGARME|ASAAS|IUGU|EFI_|GERENCIANET|PAYPAL|TWILIO|WHATSAPP|WABA|META_|FACEBOOK|EVOLUTION|EVOGO|Z_?API|RESEND|SENDGRID|MAILGUN|POSTMARK|SES_|SMTP_(PASS|PASSWORD)|MAIL_PASSWORD|ONESIGNAL|FIREBASE|FCM_|APNS)`)
	schedulerKey = regexp.MustCompile(`(?i)(SCHEDULER|CRON|JOBS?|WORKERS?|QUEUE)_?(ENABLED|ENABLE|ACTIVE|ON)?$`)
)

type envRef struct {
	Key  string
	Port uint16
	File string
}

func (a *analysis) envFiles() []envFile {
	dirs := []string{a.dir}
	for _, app := range a.apps {
		dirs = append(dirs, app.Dir)
	}
	for _, cf := range a.composes {
		dirs = append(dirs, cf.Dir)
	}
	seen := map[string]bool{}
	var out []envFile
	for _, d := range dirs {
		_, files := dirEnv(d)
		for _, f := range files {
			if !seen[f.Path] {
				seen[f.Path] = true
				out = append(out, f)
			}
		}
	}
	return out
}

func (a *analysis) isLocal(host string) bool {
	h := strings.Trim(strings.ToLower(host), "[]")
	return h == "" || h == "localhost" || h == "127.0.0.1" || h == "0.0.0.0" || h == "::1" || h == "host.docker.internal" || a.localSvc[h]
}

// checkReferencedInfra confere se cada serviço em localhost citado nos .env existe.
func (a *analysis) checkReferencedInfra() {
	appPorts := map[uint16]bool{}
	for _, app := range a.apps {
		appPorts[app.Port] = true
	}
	var refs []envRef
	for _, f := range a.envFiles() {
		for k, v := range f.Vars {
			if u, err := url.Parse(v); err == nil && u.Host != "" {
				if def, ok := urlSchemes[strings.ToLower(u.Scheme)]; ok && a.isLocal(u.Hostname()) && !a.localSvc[u.Hostname()] {
					port := def
					if p, err := strconv.ParseUint(u.Port(), 10, 16); err == nil {
						port = uint16(p)
					}
					refs = append(refs, envRef{k, port, a.rel(f.Path)})
				}
			}
			if m := hostKey.FindStringSubmatch(k); m != nil && a.isLocal(v) && !a.localSvc[v] && v != "" {
				pk := m[1] + "_PORT"
				if m[1] == "" {
					continue
				}
				if p, err := strconv.ParseUint(f.Vars[pk], 10, 16); err == nil && !appPorts[uint16(p)] {
					refs = append(refs, envRef{pk, uint16(p), a.rel(f.Path)})
				}
			}
		}
	}
	sort.Slice(refs, func(i, j int) bool { return refs[i].Port < refs[j].Port })
	for _, r := range refs {
		a.refPorts = append(a.refPorts, r.Port)
	}
	composePorts := map[uint16]string{}
	for _, cf := range a.composes {
		for _, s := range cf.Services {
			for _, p := range s.Ports {
				composePorts[p.Host] = s.Name
			}
		}
	}
	done := map[uint16]bool{}
	for _, r := range refs {
		if done[r.Port] || appPorts[r.Port] {
			continue
		}
		done[r.Port] = true
		title := fmt.Sprintf("Serviço em localhost:%d", r.Port)
		src := fmt.Sprintf("%s em %s", r.Key, r.File)
		if svc, ok := composePorts[r.Port]; ok {
			a.add(Check{Group: "Infraestrutura", Title: title, Status: OK, Detail: fmt.Sprintf("Usado por %s. Atendido pelo serviço \"%s\" do compose.", src, svc)})
			continue
		}
		if c, ok := a.containerOn(r.Port); ok {
			if c.ComposeProject == "" {
				a.contains = append(a.contains, c.Name)
				a.add(Check{Group: "Infraestrutura", Title: title, Status: Warn,
					Detail: fmt.Sprintf("Usado por %s. Atendido pelo container \"%s\", criado fora do compose. O painel liga e desliga esse container, mas não sabe recriá-lo num clone novo.", src, c.Name),
					Prompt: fmt.Sprintf("Este projeto usa um serviço em localhost:%d (%s) que hoje é o container Docker \"%s\" (imagem %s), criado à mão, fora de qualquer docker-compose. Declare esse serviço no docker-compose de desenvolvimento do projeto, com a mesma imagem, porta %d e um volume nomeado para os dados. Não apague nem recrie o container atual. Documente no README como restaurar os dados de desenvolvimento, se houver dump.", r.Port, src, c.Name, c.Image, r.Port)})
			} else {
				a.add(Check{Group: "Infraestrutura", Title: title, Status: Warn,
					Detail: fmt.Sprintf("Usado por %s. Hoje quem atende é \"%s\", do projeto compose \"%s\", que é de outra pasta.", src, c.Name, c.ComposeProject),
					Prompt: fmt.Sprintf("Este projeto depende de um serviço em localhost:%d (%s) que hoje vem do container \"%s\", de outro projeto (compose \"%s\"). Declare esse serviço no docker-compose deste projeto, com outra porta livre se preciso, para que o projeto suba sozinho. Me diga a porta escolhida.", r.Port, src, c.Name, c.ComposeProject)})
			}
			continue
		}
		if a.hostListening(r.Port) {
			a.add(Check{Group: "Infraestrutura", Title: title, Status: Warn,
				Detail: fmt.Sprintf("Usado por %s. Atendido por um processo instalado no computador, fora do Docker.", src),
				Prompt: fmt.Sprintf("Este projeto usa um serviço em localhost:%d (%s) que hoje roda instalado direto no computador, fora do Docker. Para o Server Manager ligar e desligar o ambiente, declare esse serviço no docker-compose de desenvolvimento do projeto, numa porta livre, e aponte o .env para ele. Me diga a porta escolhida.", r.Port, src)})
			continue
		}
		a.add(Check{Group: "Infraestrutura", Title: title, Status: Fail,
			Detail: fmt.Sprintf("Usado por %s, mas nenhum compose, container ou processo atende essa porta.", src),
			Prompt: fmt.Sprintf("O %s aponta para um serviço em localhost:%d, mas nada neste projeto sobe esse serviço. Descubra qual é (banco, cache, fila) e declare-o no docker-compose de desenvolvimento do projeto, com a porta %d e volume nomeado para os dados. Atualize o .env.example e o README.", src, r.Port, r.Port)})
	}
}

func (a *analysis) containerOn(port uint16) (model.Container, bool) {
	for _, p := range a.snap.Projects {
		for _, c := range p.Infra {
			for _, pt := range c.Ports {
				if pt.HostPort == port {
					return c, true
				}
			}
		}
	}
	return model.Container{}, false
}

func (a *analysis) hostListening(port uint16) bool {
	for _, l := range a.snap.Listeners {
		if l.Port == port && l.OwnedByContainer == "" {
			return true
		}
	}
	return false
}

// belongs diz se um item do painel já é deste projeto.
func (a *analysis) belongs(c model.Container, registered string) bool {
	if registered != "" && c.ProjectKey == registered {
		return true
	}
	for _, cf := range a.composes {
		if c.ComposeProject == cf.Project {
			return true
		}
	}
	for _, name := range a.contains {
		if c.Name == name {
			return true
		}
	}
	under := func(p string) bool { return p == a.dir || strings.HasPrefix(p, a.dir+string(filepath.Separator)) }
	return under(c.WorkingDir) || under(c.AppDir)
}

func (a *analysis) checkPorts(registered string) {
	type planned struct {
		port uint16
		who  string
		how  string // compose | app
		file string
	}
	var plan []planned
	for _, cf := range a.composes {
		for _, s := range cf.Services {
			if a.excluded[cf.Path+"/"+s.Name] != "" {
				continue
			}
			for _, p := range s.Ports {
				plan = append(plan, planned{p.Host, "serviço \"" + s.Name + "\" do compose", "compose", a.rel(cf.Path)})
			}
		}
	}
	for _, app := range a.apps {
		if app.Port != 0 {
			plan = append(plan, planned{app.Port, "app " + a.rel(app.Dir), "app", a.rel(app.Dir)})
		}
	}
	if len(plan) == 0 {
		return
	}
	used := map[uint16]bool{selfPort: true}
	for _, e := range a.snap.Ports {
		used[e.HostPort] = true
	}
	for _, p := range plan {
		used[p.port] = true
	}
	for _, r := range a.cfg.Ports.Reserved {
		used[r] = true
	}
	for _, r := range a.refPorts {
		used[r] = true
	}

	var free []string
	seen := map[uint16]string{}
	for _, p := range plan {
		if other, dup := seen[p.port]; dup {
			a.add(Check{Group: "Portas", Title: fmt.Sprintf("Porta %d", p.port), Status: Fail,
				Detail: fmt.Sprintf("Usada duas vezes neste projeto: %s e %s.", other, p.who),
				Prompt: fmt.Sprintf("Neste projeto, %s e %s usam a mesma porta %d do host. Troque a de %s para %d e atualize as referências (.env, .env.example, README).", other, p.who, p.port, p.who, ports.FreePort(p.port, used))})
			continue
		}
		seen[p.port] = p.who
		owner := ""
		for _, proj := range a.snap.Projects {
			for _, c := range append(append([]model.Container{}, proj.Infra...), proj.Apps...) {
				if a.belongs(c, registered) {
					continue
				}
				for _, pt := range c.Ports {
					if pt.HostPort == p.port {
						owner = fmt.Sprintf("\"%s\" do projeto \"%s\"", c.Label, proj.Name)
					}
				}
			}
		}
		if owner != "" {
			next := ports.FreePort(p.port, used)
			used[next] = true
			change := fmt.Sprintf("Troque a porta do host do %s de %d para %d no %s, sem mudar a porta interna do container.", p.who, p.port, next, p.file)
			if p.how == "app" {
				change = fmt.Sprintf("Troque a porta de desenvolvimento do %s de %d para %d (variável PORT ou flag do script).", p.who, p.port, next)
			}
			a.add(Check{Group: "Portas", Title: fmt.Sprintf("Porta %d", p.port), Status: Fail,
				Detail: fmt.Sprintf("O %s usa a porta %d, que já é de %s. Porta livre sugerida: %d.", p.who, p.port, owner, next),
				Prompt: fmt.Sprintf("A porta %d que o %s usa já pertence a %s no meu Server Manager, então os dois projetos não conseguem ficar ligados juntos. %s Atualize tudo que aponta para localhost:%d neste projeto (.env, .env.example, README, URLs de API e CORS). Não altere outros projetos.", p.port, p.who, owner, change, p.port)})
			continue
		}
		if a.hostListeningOther(p.port, registered) {
			a.add(Check{Group: "Portas", Title: fmt.Sprintf("Porta %d", p.port), Status: Warn,
				Detail: fmt.Sprintf("O %s usa a porta %d, que está em uso agora por um processo fora do Docker. Se for o próprio projeto rodando num terminal, feche-o antes de ligar pelo painel.", p.who, p.port)})
			continue
		}
		free = append(free, fmt.Sprintf("%d · %s", p.port, p.who))
	}
	if len(free) > 0 {
		a.add(Check{Group: "Portas", Title: "Portas livres", Status: OK, Detail: "Nenhum outro projeto usa estas portas.", Items: free})
	}
}

// selfPort é a porta do painel, nunca sugerida.
const selfPort = 9090

func (a *analysis) hostListeningOther(port uint16, registered string) bool {
	for _, l := range a.snap.Listeners {
		if l.Port != port || l.OwnedByContainer != "" {
			continue
		}
		// Porta de um app deste projeto ligado pelo painel.
		for _, p := range a.snap.Projects {
			for _, c := range p.Apps {
				if a.belongs(c, registered) && c.Running {
					for _, pt := range c.Ports {
						if pt.HostPort == port {
							return false
						}
					}
				}
			}
		}
		return true
	}
	return false
}

func (a *analysis) checkSecurity() {
	files := a.envFiles()
	if len(files) == 0 {
		a.add(Check{Group: "Segurança", Title: "Arquivos de ambiente", Status: Info, Detail: "Nenhum .env encontrado para revisar."})
		return
	}
	var remote, keys, sched, prod []string
	for _, f := range files {
		rel := a.rel(f.Path)
		names := make([]string, 0, len(f.Vars))
		for k := range f.Vars {
			names = append(names, k)
		}
		sort.Strings(names)
		for _, k := range names {
			v := f.Vars[k]
			if v == "" {
				continue
			}
			if u, err := url.Parse(v); err == nil && u.Host != "" {
				if _, db := urlSchemes[strings.ToLower(u.Scheme)]; db && !a.isLocal(u.Hostname()) {
					remote = append(remote, fmt.Sprintf("%s em %s aponta para %s", k, rel, u.Hostname()))
				}
			}
			if m := hostKey.FindStringSubmatch(k); m != nil && m[1] != "" && !strings.Contains(v, "://") && !a.isLocal(v) && strings.Contains(v, ".") {
				remote = append(remote, fmt.Sprintf("%s em %s aponta para %s", k, rel, v))
			}
			if sensitiveKey.MatchString(k) {
				keys = append(keys, fmt.Sprintf("%s em %s", k, rel))
			}
			if schedulerKey.MatchString(k) && isTruthy(v) {
				sched = append(sched, fmt.Sprintf("%s=%s em %s", k, v, rel))
			}
			if (k == "NODE_ENV" || k == "APP_ENV" || k == "RAILS_ENV") && strings.EqualFold(v, "production") {
				prod = append(prod, fmt.Sprintf("%s=%s em %s", k, v, rel))
			}
		}
	}
	add := func(title string, found []string, okDetail, warnDetail, prompt string) {
		if len(found) == 0 {
			a.add(Check{Group: "Segurança", Title: title, Status: OK, Detail: okDetail})
			return
		}
		a.add(Check{Group: "Segurança", Title: title, Status: Warn, Detail: warnDetail, Items: found, Prompt: prompt + "\n\nOcorrências: " + strings.Join(found, "; ") + ".\n\nNão copie valores secretos para a conversa. Me diga o que mudou e o que decidiu manter."})
	}
	add("Bancos e filas locais", remote,
		"Bancos, cache e filas dos .env apontam para esta máquina.",
		"Algum banco, cache ou fila aponta para fora desta máquina. Ligar o ambiente pode ler ou gravar dados reais.",
		"O ambiente de desenvolvimento deste projeto aponta bancos, cache ou filas para servidores fora da minha máquina. Confirme se algum deles é produção. Para desenvolvimento, aponte para os serviços locais do docker-compose do projeto e deixe o endereço remoto só em variáveis que não são lidas em dev.")
	add("Chaves de envio e cobrança", keys,
		"Nenhuma chave de mensagens, e-mail ou pagamento preenchida.",
		"Há chaves de serviços que enviam mensagens, e-mails ou fazem cobranças. Com o ambiente ligado, o app pode falar com clientes reais.",
		"Os .env de desenvolvimento deste projeto têm chaves preenchidas de serviços que enviam mensagens, e-mails ou fazem cobranças. Verifique se alguma é de produção. Em desenvolvimento, use chaves de sandbox/teste ou deixe vazio, e garanta que o código não quebra com a chave vazia.")
	add("Agendadores e workers", sched,
		"Nenhum agendador ou worker ligado por variável.",
		"Há agendadores, crons ou workers ligados. Eles podem disparar ações sozinhos assim que o ambiente subir.",
		"Os .env de desenvolvimento deste projeto ligam agendadores, crons ou workers. Verifique o que cada um dispara. Em desenvolvimento, deixe desligado por padrão tudo que envia mensagens, cobra ou altera dados externos.")
	add("Modo de desenvolvimento", prod,
		"Nenhum .env marca o ambiente como produção.",
		"Um .env de desenvolvimento declara ambiente de produção.",
		"Um .env de desenvolvimento deste projeto declara ambiente de produção. Ajuste para development nos arquivos de desenvolvimento, sem alterar a configuração de produção.")
}

func isTruthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on", "enabled", "sim":
		return true
	}
	return false
}

func (a *analysis) checkPreparation() {
	var steps []string
	walk(a.dir, 2, func(d string) {
		rel := a.rel(d)
		if exists(filepath.Join(d, "prisma", "schema.prisma")) {
			steps = append(steps, "Prisma em "+rel+": migrations")
		}
		if exists(filepath.Join(d, "artisan")) {
			steps = append(steps, "Laravel em "+rel+": migrations e seeders")
		}
		if exists(filepath.Join(d, "manage.py")) {
			steps = append(steps, "Django em "+rel+": migrations")
		}
	})
	for _, f := range []string{"README.md", "CLAUDE.md"} {
		b, err := os.ReadFile(filepath.Join(a.dir, f))
		if err == nil && regexp.MustCompile(`(?i)\b(dump|pg_restore|restore|seed)\b`).Match(b) {
			steps = append(steps, f+" cita dump, restore ou seed")
		}
	}
	if len(steps) == 0 {
		return
	}
	a.add(Check{Group: "Preparação", Title: "Dados de desenvolvimento", Status: Info,
		Detail: "Depois de criar os containers, o banco pode precisar de migrations, seed ou restauração de dump.",
		Items:  steps,
		Prompt: "Os containers de desenvolvimento deste projeto vão ser criados vazios. Escreva no README uma seção \"Preparar o banco de desenvolvimento\" com os comandos exatos para deixá-lo utilizável (migrations, seed ou restauração de dump), na ordem certa e só contra o banco local. Encontrei estes indícios: " + strings.Join(steps, "; ") + "."})
}

func (a *analysis) proposal(key, name string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "  %s:\n    name: %s\n    dir: %s\n", key, yamlStr(name), display(a.dir))
	var projects []string
	for _, cf := range a.composes {
		if cf.Err == nil {
			projects = append(projects, cf.Project)
		}
	}
	fmt.Fprintf(&b, "    compose: [%s]\n", strings.Join(projects, ", "))
	fmt.Fprintf(&b, "    containers: [%s]\n", strings.Join(a.contains, ", "))
	if len(a.apps) == 0 {
		b.WriteString("    apps: []\n")
		return b.String()
	}
	b.WriteString("    apps:\n")
	used := map[string]bool{}
	for _, app := range a.apps {
		k := defaultKey(app.Dir)
		if app.Dir == a.dir {
			k = "app"
		}
		for used[k] {
			k += "2"
		}
		used[k] = true
		fmt.Fprintf(&b, "      - key: %s\n        name: %s\n        dir: %s\n        command: %s\n", k, yamlStr(appName(app, a.rel(app.Dir))), a.rel(app.Dir), app.Command)
		if app.Port != 0 {
			fmt.Fprintf(&b, "        port: %d\n", app.Port)
		}
		if app.NodeMajor != 0 && app.NodeMajor != 24 {
			fmt.Fprintf(&b, "        image: node:%d-bookworm-slim\n", app.NodeMajor)
		}
	}
	return b.String()
}

func appName(app nodeApp, rel string) string {
	switch {
	case app.Deps["next"] || app.Deps["vite"] || app.Deps["nuxt"] || app.Deps["@angular/cli"]:
		return "Sistema"
	case app.Deps["@nestjs/core"] || app.Deps["express"] || app.Deps["fastify"]:
		return "API"
	}
	if rel == "." {
		return "App"
	}
	return filepath.Base(rel)
}

func yamlStr(s string) string {
	if strings.ContainsAny(s, ":#{}[],&*?|<>=!%@`'\"") {
		return fmt.Sprintf("%q", s)
	}
	return s
}

var keyClean = regexp.MustCompile(`[^a-z0-9]+`)

func defaultKey(dir string) string {
	k := strings.Trim(keyClean.ReplaceAllString(strings.ToLower(filepath.Base(dir)), "-"), "-")
	if k == "" {
		return "projeto"
	}
	return k
}

func display(p string) string {
	if config.HostHome != "" && (p == config.HostHome || strings.HasPrefix(p, config.HostHome+"/")) {
		return "~" + strings.TrimPrefix(p, config.HostHome)
	}
	return p
}

func combine(dir string, prompts []string) string {
	if len(prompts) == 0 {
		return ""
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%s\n\nA análise encontrou %d pendências. Resolva uma de cada vez, na ordem:\n", header(dir), len(prompts))
	for i, p := range prompts {
		fmt.Fprintf(&b, "\n%d. %s\n", i+1, p)
	}
	b.WriteString("\n" + footer)
	return b.String()
}

func header(dir string) string {
	return fmt.Sprintf("Estou preparando este projeto (%s) para o meu Server Manager, um painel local que liga e desliga ambientes de desenvolvimento em Docker.", display(dir))
}

const footer = "Não altere nada fora deste repositório e não ligue serviços que enviem mensagens ou cobranças. Ao terminar, me mostre o diff para eu rodar a análise de novo no painel."

// WithContext acrescenta o cabeçalho e o rodapé a cada prompt individual.
func WithContext(r *Result) {
	for i := range r.Checks {
		if p := r.Checks[i].Prompt; p != "" {
			r.Checks[i].Prompt = header(r.Dir) + "\n\n" + p + "\n\n" + footer
		}
	}
}
