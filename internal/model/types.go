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
	Kind     string      `json:"kind"`  // configured | compose | standalone
	State    string      `json:"state"` // on | off | partial | starting
	Dir      string      `json:"dir,omitempty"`
	Links    []Link      `json:"links"`
	Apps     []Container `json:"apps"`
	Infra    []Container `json:"infra"`
	Running  int         `json:"running"`
	Total    int         `json:"total"`
	MemUsed  uint64      `json:"memUsed"`
	Warnings []string    `json:"warnings"`
}

// HostMem é a memória da máquina lida de /proc/meminfo, em bytes.
type HostMem struct {
	Total     uint64 `json:"total"`
	Used      uint64 `json:"used"`
	Available uint64 `json:"available"`
	Cached    uint64 `json:"cached"`
	SwapTotal uint64 `json:"swapTotal"`
	SwapUsed  uint64 `json:"swapUsed"`
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
	Apps      []procfs.App   `json:"apps"` // aplicativos que mais usam memória na máquina
}
