// Package hostinfo lê memória e portas em LISTEN da máquina via /proc.
package hostinfo

import (
	"bufio"
	"io"
	"os"
	"strconv"
	"strings"

	"servermanager/internal/model"
)

// ReadMem lê /proc/meminfo. Dentro de um container sem lxcfs o arquivo reflete o host.
func ReadMem() (model.HostMem, error) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return model.HostMem{}, err
	}
	defer f.Close()
	return ParseMem(f)
}

// ParseMem interpreta o conteúdo de /proc/meminfo (valores em kB).
func ParseMem(r io.Reader) (model.HostMem, error) {
	v := map[string]uint64{}
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		key, rest, ok := strings.Cut(sc.Text(), ":")
		if !ok {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			continue
		}
		n, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			continue
		}
		v[key] = n * 1024
	}
	if err := sc.Err(); err != nil {
		return model.HostMem{}, err
	}
	m := model.HostMem{
		Total:     v["MemTotal"],
		Available: v["MemAvailable"],
		Cached:    v["Cached"] + v["Buffers"] + v["SReclaimable"],
		SwapTotal: v["SwapTotal"],
	}
	if m.Available <= m.Total {
		m.Used = m.Total - m.Available
	}
	if v["SwapFree"] <= m.SwapTotal {
		m.SwapUsed = m.SwapTotal - v["SwapFree"]
	}
	return m, nil
}
