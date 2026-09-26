package ports

import (
	"strings"
	"text/template"

	"servermanager/internal/model"
)

var promptTmpl = template.Must(template.New("prompt").Parse(`{{- $m := .Mover -}}
Preciso resolver um conflito de porta {{if or $m.App $m.ComposeService}}neste projeto{{else}}em um container Docker desta máquina{{end}}.

Contexto
{{- if $m.App}}
- App: "{{$m.Label}}" em {{$m.AppDir}}, iniciado com: {{$m.Command}}
- Hoje ele sobe na porta {{.HostPort}}/{{.Proto}}.
{{- else if $m.ComposeService}}
- Projeto: {{$m.WorkingDir}}
- Arquivo compose: {{$m.ConfigFiles}}
- Serviço: "{{$m.ComposeService}}" (container "{{$m.ContainerName}}", imagem {{$m.Image}})
{{- else}}
- Container: "{{$m.ContainerName}}" (imagem {{$m.Image}}), criado fora do docker compose
{{- end}}
{{- if not $m.App}}
- Hoje ele publica a porta {{.HostPort}}/{{.Proto}} do host para a porta {{$m.ContainerPort}} do container.
{{- end}}
- A porta {{.HostPort}} também é usada por {{.Occupant}}. Os dois não conseguem ficar ligados ao mesmo tempo.
- Porta livre proposta para este lado: {{.ProposedPort}} (conferida contra todos os containers e processos da máquina).

O que fazer
{{- if $m.App}}
1. Troque a porta de desenvolvimento desse app de {{.HostPort}} para {{.ProposedPort}}: variável PORT no .env, flag -p no script de dev ou a configuração equivalente do framework.
2. Atualize quem aponta para a porta antiga: .env e .env.example deste e de outros pacotes do projeto (URLs de API, CORS, APP_URL), README e docs (localhost:{{.HostPort}} vira localhost:{{.ProposedPort}}).
3. Me lembre de trocar port e url desse app para {{.ProposedPort}} no services.yml do Server Manager.
4. Me mostre o diff das alterações.
{{- else if $m.ComposeService}}
1. No compose, troque só o lado do host do mapeamento do serviço "{{$m.ComposeService}}": "{{.HostPort}}:{{$m.ContainerPort}}" passa a ser "{{.ProposedPort}}:{{$m.ContainerPort}}". A porta interna do container continua {{$m.ContainerPort}}. Se o mapeamento vier de variável de ambiente, ajuste a variável e o valor padrão em vez de fixar o número.
2. Procure no projeto referências à porta antiga do host e atualize para {{.ProposedPort}}: .env, .env.example, README, docs, scripts e strings de conexão (ex.: localhost:{{.HostPort}} vira localhost:{{.ProposedPort}}). Referências entre containers pela rede do compose (ex.: {{$m.ComposeService}}:{{$m.ContainerPort}}) não mudam.
3. Recrie só esse container: docker compose up -d {{$m.ComposeService}}
4. Confirme com docker compose ps que ele publica a porta {{.ProposedPort}} e me mostre o diff das alterações.
{{- else}}
1. Rode docker inspect {{$m.ContainerName}} e descubra como ele foi criado. Se algum script, README ou compose deste projeto cria esse container, altere lá para -p {{.ProposedPort}}:{{$m.ContainerPort}}.
2. Recrie o container mantendo nome, imagem, volumes, variáveis de ambiente, rede e política de restart, trocando só a porta do host para {{.ProposedPort}}. Renomeie o antigo para {{$m.ContainerName}}-old, crie o novo, confirme que ele sobe e só então remova o antigo. Não apague volumes.
3. Atualize referências a localhost:{{.HostPort}} deste container em .env, README e strings de conexão para localhost:{{.ProposedPort}}.
4. Confirme com docker ps que ele publica a porta {{.ProposedPort}}.
{{- end}}

Não altere outros serviços nem outros projetos.
`))

// Prompt gera o texto que o usuário cola no Claude Code do projeto que vai mudar de porta.
func Prompt(c model.Conflict) string {
	occupant := "um processo desta máquina que roda fora do Docker e está escutando nessa porta agora"
	if c.Keeper != nil {
		k := c.Keeper
		if k.App {
			occupant = `o app "` + k.Label + `" do projeto "` + k.ProjectName + `"`
		} else {
			occupant = `o container "` + k.ContainerName + `" do projeto "` + k.ProjectName + `"`
		}
		if k.App && k.AppDir != "" {
			occupant += " (" + k.AppDir + ")"
		} else if k.WorkingDir != "" {
			occupant += " (" + k.WorkingDir + ")"
		}
		if k.Running {
			occupant += ", que está ligado agora"
		}
	}
	var sb strings.Builder
	_ = promptTmpl.Execute(&sb, struct {
		model.Conflict
		Occupant string
	}{c, occupant})
	return strings.TrimSpace(sb.String())
}
