// Package procfs lê a tabela de processos de um /proc, só lendo arquivos que não exigem privilégio.
package procfs

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// Proc é um processo da máquina.
type Proc struct {
	PID  int
	PPID int
	Comm string // nome curto do kernel (15 caracteres)
	// Start é o início do processo, em ticks desde o boot (campo 22 do stat). Scan não preenche:
	// use StartTime, que lê o stat só de quem precisa (veja StartTime).
	Start string
	RSS   uint64 // memória residente, em bytes
	Swap  uint64 // memória do processo que está no swap, em bytes
	Argv  []string
	root  string // /proc de onde veio, para StartTime
	// Container diz se o processo roda dentro de um container (Docker, containerd, Podman), pelo cgroup.
	Container bool
	// Unit é a última parte do cgroup: "app-x.scope" (aberto num terminal) ou "y.service" (serviço do systemd).
	Unit string
}

// Args é a linha de comando com espaços.
func (p Proc) Args() string { return strings.Join(p.Argv, " ") }

// Scan lê todos os processos de root (ex.: /proc). Devolve nil se root não existe.
func Scan(root string) map[int]Proc {
	if root == "" {
		return nil
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	out := make(map[int]Proc, len(entries))
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		dir := filepath.Join(root, e.Name())
		// Só arquivos que não passam pela checagem de ptrace: o stat passa e, num container, cada leitura
		// de um processo de fora vira um bloqueio do AppArmor no log do kernel.
		p, ok := readStatus(dir, pid)
		if !ok {
			continue
		}
		p.root = root
		if b, err := os.ReadFile(filepath.Join(dir, "cmdline")); err == nil {
			for _, a := range strings.Split(strings.TrimRight(string(b), "\x00"), "\x00") {
				if a != "" {
					p.Argv = append(p.Argv, a)
				}
			}
		}
		if b, err := os.ReadFile(filepath.Join(dir, "cgroup")); err == nil {
			cg := strings.TrimSpace(string(b))
			p.Container = InContainer(cg)
			if i := strings.LastIndexByte(cg, '/'); i >= 0 {
				p.Unit = cg[i+1:]
			}
		}
		out[pid] = p
	}
	pruneStarts(root, out)
	return out
}

// InContainer diz, pelo conteúdo de /proc/<pid>/cgroup, se o processo roda num container.
func InContainer(cgroup string) bool {
	for _, mark := range []string{"docker-", "/docker/", "containerd", "libpod-", "/kubepods"} {
		if strings.Contains(cgroup, mark) {
			return true
		}
	}
	return false
}

// readStatus lê nome, processo pai e memória de /proc/<pid>/status, que não exige permissão de ptrace.
func readStatus(dir string, pid int) (Proc, bool) {
	f, err := os.Open(filepath.Join(dir, "status"))
	if err != nil {
		return Proc{}, false
	}
	defer f.Close()
	p := Proc{PID: pid}
	kb := func(v string) uint64 {
		if fields := strings.Fields(v); len(fields) > 0 {
			n, _ := strconv.ParseUint(fields[0], 10, 64)
			return n * 1024
		}
		return 0
	}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		k, v, ok := strings.Cut(sc.Text(), ":")
		if !ok {
			continue
		}
		switch k {
		case "Name":
			p.Comm = unescapeName(strings.TrimSpace(v))
		case "PPid":
			p.PPID, _ = strconv.Atoi(strings.TrimSpace(v))
		case "VmRSS":
			p.RSS = kb(v)
		case "VmSwap":
			p.Swap = kb(v)
		}
	}
	return p, p.Comm != ""
}

// unescapeName desfaz o escape do kernel no campo Name do status ("\\" e "\n").
func unescapeName(s string) string {
	if !strings.Contains(s, "\\") {
		return s
	}
	return strings.NewReplacer("\\\\", "\\", "\\n", "\n").Replace(s)
}

// O início de um processo não muda: lido uma vez por processo e guardado enquanto ele existir.
var (
	startsMu sync.Mutex
	starts   = map[startKey]string{}
)

type startKey struct {
	root string
	pid  int
	comm string
	ppid int
}

// StartTime devolve o início do processo (campo 22 do stat). O stat passa pela checagem de ptrace, então
// só é lido sob demanda (sessões do Claude, servidores fora do painel) e uma vez por processo.
func (p Proc) StartTime() string {
	if p.Start != "" || p.root == "" {
		return p.Start
	}
	k := startKey{p.root, p.PID, p.Comm, p.PPID}
	startsMu.Lock()
	defer startsMu.Unlock()
	if s, ok := starts[k]; ok {
		return s
	}
	s := readStart(filepath.Join(p.root, strconv.Itoa(p.PID)))
	if s != "" {
		starts[k] = s
	}
	return s
}

// pruneStarts esquece o início de processos que já não existem (o pid pode ser reaproveitado).
func pruneStarts(root string, procs map[int]Proc) {
	startsMu.Lock()
	defer startsMu.Unlock()
	for k := range starts {
		if k.root != root {
			continue
		}
		if p, ok := procs[k.pid]; !ok || p.Comm != k.comm || p.PPID != k.ppid {
			delete(starts, k)
		}
	}
}

func readStart(dir string) string {
	b, err := os.ReadFile(filepath.Join(dir, "stat"))
	if err != nil {
		return ""
	}
	s := string(b)
	close := strings.LastIndexByte(s, ')')
	if close < 0 {
		return ""
	}
	f := strings.Fields(s[close+1:])
	if len(f) < 20 {
		return ""
	}
	return f[19]
}
