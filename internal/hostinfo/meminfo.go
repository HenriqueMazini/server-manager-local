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
		Shmem:     v["Shmem"],
	}
	if m.Available <= m.Total {
		m.Used = m.Total - m.Available
	}
	if v["SwapFree"] <= m.SwapTotal {
		m.SwapUsed = m.SwapTotal - v["SwapFree"]
	}
	return m, nil
}

// ReadPressure lê a pressão de memória de procRoot/pressure/memory. Linhas:
//
//	some avg10=0.00 avg60=0.02 avg300=3.83 total=1961167819
//	full avg10=0.00 avg60=0.02 avg300=3.54 total=1744466132
func ReadPressure(procRoot string) model.Pressure {
	b, err := os.ReadFile(procRoot + "/pressure/memory")
	if err != nil {
		return model.Pressure{}
	}
	return ParsePressure(string(b))
}

// ParsePressure interpreta o conteúdo de /proc/pressure/memory.
func ParsePressure(s string) model.Pressure {
	p := model.Pressure{}
	for _, line := range strings.Split(s, "\n") {
		f := strings.Fields(line)
		if len(f) < 3 {
			continue
		}
		vals := map[string]float64{}
		for _, kv := range f[1:] {
			k, v, ok := strings.Cut(kv, "=")
			if !ok {
				continue
			}
			n, err := strconv.ParseFloat(v, 64)
			if err == nil {
				vals[k] = n
			}
		}
		switch f[0] {
		case "some":
			p.Available = true
			p.Some10, p.Some60, p.Some300 = vals["avg10"], vals["avg60"], vals["avg300"]
		case "full":
			p.Full10, p.Full60 = vals["avg10"], vals["avg60"]
		}
	}
	return p
}
