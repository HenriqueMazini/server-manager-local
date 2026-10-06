// Package procfs lê a tabela de processos de um /proc, só lendo arquivos que não exigem privilégio.
package procfs

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Proc é um processo da máquina.
type Proc struct {
	PID   int
	PPID  int
	Comm  string // nome curto do kernel (15 caracteres)
	Start string // início do processo, em ticks desde o boot (campo 22 do stat)
	RSS   uint64 // memória residente, em bytes
	Argv  []string
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
		p, ok := readStat(dir, pid)
		if !ok {
			continue
		}
		p.RSS = readRSS(dir)
		if b, err := os.ReadFile(filepath.Join(dir, "cmdline")); err == nil {
			for _, a := range strings.Split(strings.TrimRight(string(b), "\x00"), "\x00") {
				if a != "" {
					p.Argv = append(p.Argv, a)
				}
			}
		}
		out[pid] = p
	}
	return out
}

func readStat(dir string, pid int) (Proc, bool) {
	b, err := os.ReadFile(filepath.Join(dir, "stat"))
	if err != nil {
		return Proc{}, false
	}
	s := string(b)
	open, close := strings.IndexByte(s, '('), strings.LastIndexByte(s, ')')
	if open < 0 || close < open {
		return Proc{}, false
	}
	f := strings.Fields(s[close+1:])
	if len(f) < 20 {
		return Proc{}, false
	}
	ppid, _ := strconv.Atoi(f[1])
	return Proc{PID: pid, PPID: ppid, Comm: s[open+1 : close], Start: f[19]}, true
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
			if fields := strings.Fields(v); len(fields) > 0 {
				n, _ := strconv.ParseUint(fields[0], 10, 64)
				return n * 1024
			}
		}
	}
	return 0
}
