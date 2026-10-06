// Package claude lista as sessões do Claude Code abertas no computador e a memória de cada uma.
//
// Fontes, só leitura:
//   - /proc do computador (montado em SM_PROC_ROOT): memória (VmRSS), processo pai e comando.
//   - ~/.claude/sessions/<pid>.json: nome, pasta, estado e versão que o Claude Code grava por sessão.
//     O formato é interno do Claude Code; sem ele, a sessão aparece só com o comando.
package claude

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"servermanager/internal/procfs"
)

// Session é uma sessão do Claude Code em execução.
type Session struct {
	PID       int       `json:"pid"`
	Name      string    `json:"name"`
	Cwd       string    `json:"cwd,omitempty"`
	Status    string    `json:"status"` // busy | waiting | idle | unknown
	Version   string    `json:"version,omitempty"`
	StartedAt time.Time `json:"startedAt,omitempty"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"` // última mudança de estado registrada pelo Claude Code
	MemUsed   uint64    `json:"memUsed"`             // sessão + processos filhos (MCP, comandos), em bytes
	Procs     int       `json:"procs"`
	Children  []Child   `json:"children"`
}

// Child é um processo filho que pesa na sessão.
type Child struct {
	Name    string `json:"name"`
	MemUsed uint64 `json:"memUsed"`
}

// Summary é o bloco das sessões no snapshot.
type Summary struct {
	Available bool      `json:"available"` // false quando o painel não enxerga os processos do computador
	Sessions  []Session `json:"sessions"`
	MemUsed   uint64    `json:"memUsed"`
}

// Read monta o resumo a partir de /proc (procRoot). sessionsDir é ~/.claude/sessions.
func Read(procRoot, sessionsDir, home string) Summary {
	return FromProcs(procfs.Scan(procRoot), sessionsDir, home)
}

// FromProcs monta o resumo a partir de uma tabela de processos já lida.
func FromProcs(procs map[int]procfs.Proc, sessionsDir, home string) Summary {
	out := Summary{Sessions: []Session{}}
	if len(procs) == 0 {
		return out
	}
	out.Available = true

	children := map[int][]int{}
	for _, p := range procs {
		children[p.PPID] = append(children[p.PPID], p.PID)
	}

	// Sessão = processo "claude" cujo pai não é outro "claude".
	for _, p := range procs {
		if p.Comm != "claude" {
			continue
		}
		if parent, ok := procs[p.PPID]; ok && parent.Comm == "claude" {
			continue
		}
		s := Session{PID: p.PID, Name: "claude " + strings.TrimSpace(strings.TrimPrefix(p.Args(), "claude")), Status: "unknown", Children: []Child{}}
		if meta, ok := readMeta(sessionsDir, p); ok {
			if meta.Name != "" {
				s.Name = meta.Name
			}
			s.Cwd = shorten(meta.Cwd, home)
			if meta.Status != "" {
				s.Status = meta.Status
			}
			s.Version = meta.Version
			if meta.StartedAt > 0 {
				s.StartedAt = time.UnixMilli(meta.StartedAt)
			}
			if t := max(meta.UpdatedAt, meta.StatusAt); t > 0 {
				s.UpdatedAt = time.UnixMilli(t)
			}
		}
		if strings.TrimSpace(s.Name) == "claude" {
			s.Name = "claude"
		}
		// Soma a árvore inteira: servidores MCP, comandos em execução, subagentes.
		stack := []int{p.PID}
		for len(stack) > 0 {
			pid := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			q := procs[pid]
			s.MemUsed += q.RSS
			s.Procs++
			if pid != p.PID && q.RSS > 0 {
				s.Children = append(s.Children, Child{Name: childName(q), MemUsed: q.RSS})
			}
			stack = append(stack, children[pid]...)
		}
		sort.Slice(s.Children, func(i, j int) bool { return s.Children[i].MemUsed > s.Children[j].MemUsed })
		out.Sessions = append(out.Sessions, s)
		out.MemUsed += s.MemUsed
	}
	sortSessions(out.Sessions)
	return out
}

// sortSessions põe primeiro quem está trabalhando; dentro de cada grupo, a atualização mais recente.
func sortSessions(ss []Session) {
	sort.SliceStable(ss, func(i, j int) bool {
		bi, bj := ss[i].Status == "busy", ss[j].Status == "busy"
		if bi != bj {
			return bi
		}
		if !ss[i].UpdatedAt.Equal(ss[j].UpdatedAt) {
			return ss[i].UpdatedAt.After(ss[j].UpdatedAt)
		}
		return ss[i].PID > ss[j].PID
	})
}

type meta struct {
	PID       int    `json:"pid"`
	Cwd       string `json:"cwd"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	Version   string `json:"version"`
	StartedAt int64  `json:"startedAt"`
	UpdatedAt int64  `json:"updatedAt"`
	StatusAt  int64  `json:"statusUpdatedAt"`
	ProcStart string `json:"procStart"`
}

// readMeta só aceita o arquivo se o início do processo bate: PID reaproveitado não herda a sessão antiga.
func readMeta(dir string, p procfs.Proc) (meta, bool) {
	b, err := os.ReadFile(filepath.Join(dir, strconv.Itoa(p.PID)+".json"))
	if err != nil {
		return meta{}, false
	}
	var m meta
	if json.Unmarshal(b, &m) != nil || m.PID != p.PID {
		return meta{}, false
	}
	if m.ProcStart != "" && m.ProcStart != p.Start {
		return meta{}, false
	}
	return m, true
}

func childName(p procfs.Proc) string {
	a := p.Args()
	if a == "" {
		return p.Comm
	}
	if i := strings.Index(a, "/.claude/mcp/"); i >= 0 {
		rest := a[i+len("/.claude/mcp/"):]
		name, _, _ := strings.Cut(rest, "/")
		return "MCP " + name
	}
	if len(a) > 80 {
		a = a[:77] + "…"
	}
	return a
}

func shorten(p, home string) string {
	if home != "" && (p == home || strings.HasPrefix(p, home+"/")) {
		return "~" + strings.TrimPrefix(p, home)
	}
	return p
}
