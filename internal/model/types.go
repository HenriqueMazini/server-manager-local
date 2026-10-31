// Package model define os tipos JSON trocados entre o backend e o painel.
package model

import (
	"time"

	"servermanager/internal/claude"
	"servermanager/internal/procfs"
)

// Port é uma porta publicada no host por um container.
type Port struct {
	HostIP        string `json:"hostIp"`
	HostPort      uint16 `json:"hostPort"`
	ContainerPort uint16 `json:"containerPort"`
	Proto         string `json:"proto"`
	URL           string `json:"url"`
}

// Container é um item de um projeto: container de infraestrutura ou app de desenvolvimento.
type Container struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Label          string `json:"label"`
	Role           string `json:"role"` // infra | app
	Image          string `json:"image"`
	State          string `json:"state"`
	Status         string `json:"status"`
	Health         string `json:"health,omitempty"`
	Running        bool   `json:"running"`
	Exists         bool   `json:"exists"`
	Listening      bool   `json:"listening"` // app com a porta já em LISTEN
	External       bool   `json:"external"`  // app parado, mas a porta dele está ocupada fora do painel
	ProjectKey     string `json:"projectKey"`
	ProjectName    string `json:"projectName"`
	ComposeProject string `json:"composeProject,omitempty"`
	ComposeService string `json:"composeService,omitempty"`
	WorkingDir     string `json:"workingDir,omitempty"`
	ConfigFiles    string `json:"configFiles,omitempty"`
	Command        string `json:"command,omitempty"`
	AppDir         string `json:"appDir,omitempty"`
	Ports          []Port `json:"ports"`
	MemUsed        uint64 `json:"memUsed"`
	MemLimit       uint64 `json:"memLimit"`
	SwapUsed       uint64 `json:"swapUsed,omitempty"` // memória dos processos do container que está no swap
}

// Worktree liga um projeto compose de uma worktree do git ao projeto principal.
type Worktree struct {
	MainDir  string `json:"mainDir"`
	MainName string `json:"mainName"`
	MainKey  string `json:"mainKey,omitempty"`
	Branch   string `json:"branch,omitempty"`
	Missing  bool   `json:"missing,omitempty"` // worktree já removida do git; só sobraram os containers
}

// Link é um endereço de acesso exibido no cabeçalho do projeto.
type Link struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

// Project é o que o painel liga e desliga de uma vez.
type Project struct {
	Key      string      `json:"key"`
	Name     string      `json:"name"`
	Kind     string      `json:"kind"`            // configured | compose | standalone
	Alias    string      `json:"alias,omitempty"` // apelido digitado no painel, mostrado entre parênteses
	State    string      `json:"state"`           // on | off | partial | starting
	Dir      string      `json:"dir,omitempty"`
	Links    []Link      `json:"links"`
	Apps     []Container `json:"apps"`
	Infra    []Container `json:"infra"`
	Running  int         `json:"running"`
	Total    int         `json:"total"`
	MemUsed  uint64      `json:"memUsed"`
	SwapUsed uint64      `json:"swapUsed,omitempty"`
	Warnings []string    `json:"warnings"`
	Worktree *Worktree   `json:"worktree,omitempty"`
}

// HostMem é a memória da máquina lida de /proc/meminfo, em bytes.
type HostMem struct {
	Total     uint64 `json:"total"`
	Used      uint64 `json:"used"`
	Available uint64 `json:"available"`
	Cached    uint64 `json:"cached"`
	SwapTotal uint64 `json:"swapTotal"`
	SwapUsed  uint64 `json:"swapUsed"`
	Shmem     uint64 `json:"shmem"` // memória compartilhada e tmpfs: vai para o swap sem aparecer em processo nenhum
}

// Pressure é a pressão de memória do computador (/proc/pressure/memory): a fração do tempo em que
// tarefas ficaram esperando memória, em %. É o que o systemd-oomd vigia para encerrar processos.
type Pressure struct {
	Available bool    `json:"available"`
	Some10    float64 `json:"some10"`
	Some60    float64 `json:"some60"`
	Some300   float64 `json:"some300"`
	Full10    float64 `json:"full10"`
	Full60    float64 `json:"full60"`
}

// HostListener é uma porta TCP em LISTEN na máquina.
type HostListener struct {
	Port             uint16 `json:"port"`
	Proto            string `json:"proto"`
	Addr             string `json:"addr"`
	OwnedByContainer string `json:"ownedByContainer,omitempty"`
}

// PortEntry é uma linha do inventário de portas exibido no painel.
type PortEntry struct {
	HostPort      uint16 `json:"hostPort"`
	Proto         string `json:"proto"`
	Kind          string `json:"kind"` // container | host
	ProjectKey    string `json:"projectKey,omitempty"`
	ProjectName   string `json:"projectName,omitempty"`
	ContainerName string `json:"containerName,omitempty"`
	Label         string `json:"label,omitempty"`
	ContainerPort uint16 `json:"containerPort,omitempty"`
	Running       bool   `json:"running"`
	URL           string `json:"url,omitempty"`
	Conflict      bool   `json:"conflict"`
}

// ConflictParty é um dos lados de um conflito de porta.
type ConflictParty struct {
	ProjectKey     string `json:"projectKey"`
	ProjectName    string `json:"projectName"`
	ContainerName  string `json:"containerName"`
	Label          string `json:"label"`
	App            bool   `json:"app"`
	Command        string `json:"command,omitempty"`
	AppDir         string `json:"appDir,omitempty"`
	Image          string `json:"image"`
	ComposeService string `json:"composeService,omitempty"`
	ConfigFiles    string `json:"configFiles,omitempty"`
	WorkingDir     string `json:"workingDir,omitempty"`
	ContainerPort  uint16 `json:"containerPort"`
	Running        bool   `json:"running"`
}

// Conflict descreve duas partes disputando a mesma porta do host.
type Conflict struct {
	ID           string         `json:"id"`
	Kind         string         `json:"kind"` // container-container | container-host
	HostPort     uint16         `json:"hostPort"`
	Proto        string         `json:"proto"`
	Keeper       *ConflictParty `json:"keeper,omitempty"` // nil quando quem ocupa é um processo do host
	Mover        ConflictParty  `json:"mover"`
	ProposedPort uint16         `json:"proposedPort"`
	Prompt       string         `json:"prompt"`
}

// Temporary é um container temporário criado por ferramentas (testes, docker run --rm). Não vira projeto.
type Temporary struct {
	Name    string `json:"name"`
	Image   string `json:"image"`
	Origin  string `json:"origin"` // testcontainers | --rm
	Running bool   `json:"running"`
}

// Orphan é um container de app criado pelo painel que não pertence mais a nenhum projeto.
type Orphan struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Project string `json:"project"` // chave antiga do projeto
	App     string `json:"app"`
	Running bool   `json:"running"`
	Status  string `json:"status"`
}

// Snapshot é o estado completo enviado ao painel.
type Snapshot struct {
	At        time.Time      `json:"at"`
	Version   string         `json:"version"`
	Docker    bool           `json:"docker"`
	Error     string         `json:"error,omitempty"`
	Host      HostMem        `json:"host"`
	Projects  []Project      `json:"projects"`
	Ports     []PortEntry    `json:"ports"`
	Conflicts []Conflict     `json:"conflicts"`
	Listeners []HostListener `json:"listeners"`
	Claude    claude.Summary `json:"claude"`
	Apps      []procfs.App   `json:"apps"`
	Orphans   []Orphan       `json:"orphans"`
	Temporary []Temporary    `json:"temporary"` // ocultos da lista de projetos
	DevRuns   []DevRun       `json:"devRuns"`   // servidores de desenvolvimento rodando fora do Docker
	Pressure  Pressure       `json:"pressure"`
	SwapApps  []procfs.App   `json:"swapApps"` // aplicativos com mais memória no swap
	Disks     []DiskFS       `json:"disks"`    // disco onde fica o Docker e, se for outro, o da pasta pessoal
}

// DevRun é um servidor de desenvolvimento rodando direto no computador, fora do Docker: o processo que foi iniciado (npm run dev) e tudo abaixo dele.
type DevRun struct {
	PID         int      `json:"pid"`
	Start       string   `json:"start"`                // início do processo, para o ajudante conferir o pid
	Command     string   `json:"command"`              // o que foi iniciado, curto ("next dev --webpack")
	Dir         string   `json:"dir"`                  // pasta de onde veio (~/projetos/loja-wt/feature)
	ProjectKey  string   `json:"projectKey,omitempty"` // projeto do painel, quando reconhecido
	ProjectName string   `json:"projectName"`          // nome do projeto, ou da pasta
	Worktree    string   `json:"worktree,omitempty"`   // nome da worktree, quando vem de uma
	MemUsed     uint64   `json:"memUsed"`              // soma do processo e de todos os filhos
	SwapUsed    uint64   `json:"swapUsed,omitempty"`   // parte no swap
	Procs       int      `json:"procs"`
	Orphan      bool     `json:"orphan"` // quem iniciou já fechou: o processo ficou pendurado no systemd
	Programs    []string `json:"programs"`
}

// DiskFS é o uso de um sistema de arquivos do computador (como o df), em bytes.
type DiskFS struct {
	Path  string `json:"path"`
	Total uint64 `json:"total"`
	Used  uint64 `json:"used"`
	Free  uint64 `json:"free"` // disponível para o usuário
}

// DiskCategory é uma categoria do docker system df: o total e quanto dá para liberar.
type DiskCategory struct {
	Count       int    `json:"count"`
	Active      int    `json:"active"`
	Total       uint64 `json:"total"`
	Reclaimable uint64 `json:"reclaimable"`
}

// DiskImage é uma imagem sem container usando.
type DiskImage struct {
	ID      string    `json:"id"`
	Tags    []string  `json:"tags"`
	Size    uint64    `json:"size"`
	Created time.Time `json:"created"`
	Local   bool      `json:"local"` // construída aqui (sem digest de registro): só volta com um novo build
}

// DiskVolume é um volume sem container usando.
type DiskVolume struct {
	Name      string    `json:"name"`
	Project   string    `json:"project,omitempty"` // projeto do compose (label), ou o prefixo do nome
	Size      uint64    `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

// DockerDisk é o que o Docker ocupa no disco, por categoria, e o que está sem uso. Calculado sob
// demanda e guardado alguns minutos: com centenas de volumes, o cálculo leva segundos.
type DockerDisk struct {
	At           time.Time     `json:"at"`
	Error        string        `json:"error,omitempty"`
	Build        DiskCategory  `json:"build"`
	Images       DiskCategory  `json:"images"`
	Containers   DiskCategory  `json:"containers"`
	Volumes      DiskCategory  `json:"volumes"`
	AnonUnused   DiskCategory  `json:"anonUnused"` // volumes anônimos sem uso: Count e Total
	AnonSample   []DiskVolume  `json:"anonSample"` // os maiores, para mostrar antes de apagar
	NamedUnused  []DiskVolume  `json:"namedUnused"`
	UnusedImages []DiskImage   `json:"unusedImages"`
	History      VolumeHistory `json:"history"`
}

// VolumeHistory conta os volumes anônimos criados por semana e quem os criou, a partir dos eventos
// do Docker que o painel acompanha (gravado em data/volumes.json).
type VolumeHistory struct {
	Since   time.Time      `json:"since"`
	Weeks   []WeekCount    `json:"weeks"`
	Sources []VolumeSource `json:"sources"`
}

// WeekCount é quantos volumes anônimos foram criados na semana que começa em Week (segunda-feira).
type WeekCount struct {
	Week  string `json:"week"`
	Count int    `json:"count"`
}

// VolumeSource é a imagem (e o projeto ou ferramenta) que montou volumes anônimos novos.
type VolumeSource struct {
	Image  string    `json:"image"`
	Origin string    `json:"origin,omitempty"` // projeto do compose, "testcontainers", ou vazio
	Dir    string    `json:"dir,omitempty"`    // pasta do projeto, quando o compose informa
	Count  int       `json:"count"`
	Last   time.Time `json:"last"`
}
