// Package ports monta o inventário de portas, detecta conflitos e propõe portas livres.
package ports

import (
	"fmt"
	"sort"

	"servermanager/internal/hostinfo"
	"servermanager/internal/model"
)

// Result é a análise completa de portas.
type Result struct {
	Listeners []model.HostListener
	Entries   []model.PortEntry
	Conflicts []model.Conflict
}

type binding struct {
	c *model.Container
	p model.Port
}

type key struct {
	port  uint16
	proto string
}

// Analyze cruza as portas de todos os containers (ligados ou não) com as portas em LISTEN da máquina.
func Analyze(containers []model.Container, listeners []model.HostListener, reserved []uint16) Result {
	groups := map[key][]binding{}
	for i := range containers {
		c := &containers[i]
		for _, p := range c.Ports {
			k := key{p.HostPort, p.Proto}
			groups[k] = append(groups[k], binding{c, p})
		}
	}

	// A porta de um container ligado aparece em LISTEN pelo docker-proxy: não é processo do host.
	ls := make([]model.HostListener, len(listeners))
	copy(ls, listeners)
	for i := range ls {
		for _, b := range groups[key{ls[i].Port, ls[i].Proto}] {
			if b.c.Running && overlaps(b.p.HostIP, ls[i].Addr) {
				ls[i].OwnedByContainer = b.c.Name
				break
			}
		}
	}

	used := map[uint16]bool{}
	for k := range groups {
		used[k.port] = true
	}
	for _, l := range ls {
		used[l.Port] = true
	}
	for _, r := range reserved {
		used[r] = true
	}

	keys := make([]key, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].port != keys[j].port {
			return keys[i].port < keys[j].port
		}
		return keys[i].proto < keys[j].proto
	})

	var conflicts []model.Conflict
	moved := map[string]bool{} // container+porta que já recebeu proposta
	for _, k := range keys {
		bs := groups[k]
		sort.SliceStable(bs, func(i, j int) bool {
			if bs[i].c.Running != bs[j].c.Running {
				return bs[i].c.Running
			}
			if bs[i].c.ProjectKey != bs[j].c.ProjectKey {
				return bs[i].c.ProjectKey < bs[j].c.ProjectKey
			}
			return bs[i].c.Name < bs[j].c.Name
		})
		keeper := bs[0]
		for _, b := range bs[1:] {
			if b.c.ProjectKey == keeper.c.ProjectKey || !overlaps(b.p.HostIP, keeper.p.HostIP) {
				continue
			}
			kp := party(keeper)
			conflicts = append(conflicts, newConflict("container-container", k, &kp, party(b), used))
			moved[moveID(b)] = true
		}
		if k.proto != "tcp" {
			continue
		}
		for _, b := range bs {
			// App parado com a porta ocupada vira aviso no projeto, não conflito: quase sempre é o
			// mesmo app rodando no terminal.
			if b.c.Running || b.c.Role == "app" || moved[moveID(b)] {
				continue
			}
			for _, l := range ls {
				if l.Port == k.port && l.Proto == k.proto && l.OwnedByContainer == "" && overlaps(b.p.HostIP, l.Addr) {
					conflicts = append(conflicts, newConflict("container-host", k, nil, party(b), used))
					moved[moveID(b)] = true
					break
				}
			}
		}
	}

	inConflict := map[key]bool{}
	for _, c := range conflicts {
		inConflict[key{c.HostPort, c.Proto}] = true
	}
	var entries []model.PortEntry
	for _, k := range keys {
		for _, b := range groups[k] {
			entries = append(entries, model.PortEntry{
				HostPort: k.port, Proto: k.proto, Kind: "container",
				ProjectKey: b.c.ProjectKey, ProjectName: b.c.ProjectName, ContainerName: b.c.Name, Label: b.c.Label,
				ContainerPort: b.p.ContainerPort, Running: b.c.Running, URL: b.p.URL, Conflict: inConflict[k],
			})
		}
	}
	for _, l := range ls {
		if l.OwnedByContainer == "" {
			entries = append(entries, model.PortEntry{
				HostPort: l.Port, Proto: l.Proto, Kind: "host", Running: true,
				Conflict: inConflict[key{l.Port, l.Proto}],
			})
		}
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].HostPort < entries[j].HostPort })
	if conflicts == nil {
		conflicts = []model.Conflict{}
	}
	if entries == nil {
		entries = []model.PortEntry{}
	}
	return Result{Listeners: ls, Entries: entries, Conflicts: conflicts}
}

func newConflict(kind string, k key, keeper *model.ConflictParty, mover model.ConflictParty, used map[uint16]bool) model.Conflict {
	proposed := FreePort(k.port, used)
	used[proposed] = true
	c := model.Conflict{
		ID:           fmt.Sprintf("%s-%d-%s", k.proto, k.port, mover.ContainerName),
		Kind:         kind,
		HostPort:     k.port,
		Proto:        k.proto,
		Keeper:       keeper,
		Mover:        mover,
		ProposedPort: proposed,
	}
	c.Prompt = Prompt(c)
	return c
}

// FreePort procura a primeira porta acima de from que ninguém usa.
func FreePort(from uint16, used map[uint16]bool) uint16 {
	p := int(from)
	for range 65535 {
		p++
		if p > 65535 {
			p = 1024
		}
		if !used[uint16(p)] {
			return uint16(p)
		}
	}
	return 0
}

func party(b binding) model.ConflictParty {
	return model.ConflictParty{
		ProjectKey:     b.c.ProjectKey,
		ProjectName:    b.c.ProjectName,
		ContainerName:  b.c.Name,
		Label:          b.c.Label,
		Image:          b.c.Image,
		App:            b.c.Role == "app",
		Command:        b.c.Command,
		AppDir:         b.c.AppDir,
		ComposeService: b.c.ComposeService,
		ConfigFiles:    b.c.ConfigFiles,
		WorkingDir:     b.c.WorkingDir,
		ContainerPort:  b.p.ContainerPort,
		Running:        b.c.Running,
	}
}

func moveID(b binding) string { return fmt.Sprintf("%s/%d/%s", b.c.ID, b.p.HostPort, b.p.Proto) }

// overlaps diz se dois endereços de bind disputam a mesma porta.
func overlaps(a, b string) bool {
	return hostinfo.IsWildcard(a) || hostinfo.IsWildcard(b) || a == b
}
