// Package claude lista as sessões do Claude Code abertas no computador e a memória de cada uma.
//
// Fontes, só leitura:
//   - /proc do computador (montado em SM_PROC_ROOT): memória (VmRSS), processo pai e comando.
//   - ~/.claude/sessions/<pid>.json: nome, pasta, estado e versão que o Claude Code grava por sessão.
//     O formato é interno do Claude Code; sem ele, a sessão aparece só com o comando.
package claude

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Session é uma sessão do Claude Code em execução.
type Session struct {
	PID       int       `json:"pid"`
	Name      string    `json:"name"`
	Cwd       string    `json:"cwd,omitempty"`
	Status    string    `json:"status"` // busy | waiting | idle | unknown
	Version   string    `json:"version,omitempty"`
	StartedAt time.Time `json:"startedAt,omitempty"`
	MemUsed   uint64    `json:"memUsed"` // sessão + processos filhos (MCP, comandos), em bytes
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

type proc struct {
	pid, ppid int
	comm      string
	start     string
	rss       uint64
	args      string
}

// Read monta o resumo. procRoot é o /proc do computador; sessionsDir é ~/.claude/sessions.
func Read(procRoot, sessionsDir, home string) Summary {
	out := Summary{Sessions: []Session{}}
	procs := scan(procRoot)
	if len(procs) == 0 {
		return out
	}
	out.Available = true

	children := map[int][]int{}
	for _, p := range procs {
		children[p.ppid] = append(children[p.ppid], p.pid)
	}

	// Sessão = processo "claude" cujo pai não é outro "claude".
	for _, p := range procs {
		if p.comm != "claude" {
			continue
		}
		if parent, ok := procs[p.ppid]; ok && parent.comm == "claude" {
			continue
		}
		s := Session{PID: p.pid, Name: "claude " + strings.TrimSpace(strings.TrimPrefix(p.args, "claude")), Status: "unknown", Children: []Child{}}
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
		}
		if strings.TrimSpace(s.Name) == "claude" {
			s.Name = "claude"
		}
		// Soma a árvore inteira: servidores MCP, comandos em execução, subagentes.
		stack := []int{p.pid}
		for len(stack) > 0 {
			pid := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			q := procs[pid]
			s.MemUsed += q.rss
			s.Procs++
			if pid != p.pid && q.rss > 0 {
				s.Children = append(s.Children, Child{Name: childName(q), MemUsed: q.rss})
			}
			stack = append(stack, children[pid]...)
		}
		sort.Slice(s.Children, func(i, j int) bool { return s.Children[i].MemUsed > s.Children[j].MemUsed })
		out.Sessions = append(out.Sessions, s)
		out.MemUsed += s.MemUsed
	}
	sort.Slice(out.Sessions, func(i, j int) bool { return out.Sessions[i].MemUsed > out.Sessions[j].MemUsed })
	return out
}

type meta struct {
	PID       int    `json:"pid"`
	Cwd       string `json:"cwd"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	Version   string `json:"version"`
	StartedAt int64  `json:"startedAt"`
	ProcStart string `json:"procStart"`
}

// readMeta só aceita o arquivo se o início do processo bate: PID reaproveitado não herda a sessão antiga.
func readMeta(dir string, p proc) (meta, bool) {
	b, err := os.ReadFile(filepath.Join(dir, strconv.Itoa(p.pid)+".json"))
	if err != nil {
		return meta{}, false
	}
	var m meta
	if json.Unmarshal(b, &m) != nil || m.PID != p.pid {
		return meta{}, false
	}
	if m.ProcStart != "" && m.ProcStart != p.start {
		return meta{}, false
	}
	return m, true
}

func scan(root string) map[int]proc {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	out := make(map[int]proc, len(entries))
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		dir := filepath.Join(root, e.Name())
		p, ok := readStat(dir, pid)
		if !ok {
			continue
		}
		p.rss = readRSS(dir)
		if b, err := os.ReadFile(filepath.Join(dir, "cmdline")); err == nil {
			p.args = strings.TrimSpace(strings.ReplaceAll(string(b), "\x00", " "))
		}
		out[pid] = p
	}
	return out
}

// readStat lê pid, comm, ppid e o início do processo (campo 22) de /proc/<pid>/stat.
func readStat(dir string, pid int) (proc, bool) {
	b, err := os.ReadFile(filepath.Join(dir, "stat"))
	if err != nil {
		return proc{}, false
	}
	s := string(b)
	open, close := strings.IndexByte(s, '('), strings.LastIndexByte(s, ')')
	if open < 0 || close < open {
		return proc{}, false
	}
	f := strings.Fields(s[close+1:])
	if len(f) < 20 {
		return proc{}, false
	}
	ppid, _ := strconv.Atoi(f[1])
	return proc{pid: pid, ppid: ppid, comm: s[open+1 : close], start: f[19]}, true
}

func readRSS(dir string) uint64 {
	f, err := os.Open(filepath.Join(dir, "status"))
	if err != nil {
		return 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if v, ok := strings.CutPrefix(sc.Text(), "VmRSS:"); ok {
			fields := strings.Fields(v)
			if len(fields) > 0 {
				n, _ := strconv.ParseUint(fields[0], 10, 64)
				return n * 1024
			}
		}
	}
	return 0
}

func childName(p proc) string {
	a := p.args
	if a == "" {
		return p.comm
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
