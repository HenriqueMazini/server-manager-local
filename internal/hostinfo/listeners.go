package hostinfo

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"io"
	"net/netip"
	"os"
	"sort"
	"strconv"
	"strings"

	"servermanager/internal/model"
)

const tcpListen = "0A"

// ReadListeners lista as portas TCP em LISTEN do namespace de rede atual.
// Com network_mode: host, esse namespace é o da máquina.
func ReadListeners() ([]model.HostListener, error) {
	var all []model.HostListener
	for _, path := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		f, err := os.Open(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		ls, err := ParseListeners(f)
		f.Close()
		if err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		all = append(all, ls...)
	}
	return Dedupe(all), nil
}

// ParseListeners interpreta /proc/net/tcp ou /proc/net/tcp6 e devolve só as linhas em LISTEN.
func ParseListeners(r io.Reader) ([]model.HostListener, error) {
	var out []model.HostListener
	sc := bufio.NewScanner(r)
	first := true
	for sc.Scan() {
		if first {
			first = false
			continue
		}
		f := strings.Fields(sc.Text())
		if len(f) < 4 || f[3] != tcpListen {
			continue
		}
		addr, port, err := parseAddr(f[1])
		if err != nil {
			return nil, err
		}
		out = append(out, model.HostListener{Port: port, Proto: "tcp", Addr: addr})
	}
	return out, sc.Err()
}

// parseAddr converte "0100007F:0277" em ("127.0.0.1", 631).
// O kernel escreve o IP como palavras de 32 bits na ordem do host (little-endian no x86).
func parseAddr(s string) (string, uint16, error) {
	ipHex, portHex, ok := strings.Cut(s, ":")
	if !ok {
		return "", 0, fmt.Errorf("endereço inválido %q", s)
	}
	p, err := strconv.ParseUint(portHex, 16, 16)
	if err != nil {
		return "", 0, fmt.Errorf("porta inválida %q", s)
	}
	raw, err := hex.DecodeString(ipHex)
	if err != nil || (len(raw) != 4 && len(raw) != 16) {
		return "", 0, fmt.Errorf("ip inválido %q", s)
	}
	for i := 0; i < len(raw); i += 4 {
		raw[i], raw[i+1], raw[i+2], raw[i+3] = raw[i+3], raw[i+2], raw[i+1], raw[i]
	}
	ip, _ := netip.AddrFromSlice(raw)
	return ip.Unmap().String(), uint16(p), nil
}

// Dedupe mantém uma entrada por (porta, proto), preferindo o endereço curinga.
func Dedupe(ls []model.HostListener) []model.HostListener {
	type key struct {
		port  uint16
		proto string
	}
	best := map[key]model.HostListener{}
	for _, l := range ls {
		k := key{l.Port, l.Proto}
		cur, ok := best[k]
		if !ok || (IsWildcard(l.Addr) && !IsWildcard(cur.Addr)) {
			best[k] = l
		}
	}
	out := make([]model.HostListener, 0, len(best))
	for _, l := range best {
		out = append(out, l)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Port < out[j].Port })
	return out
}

// IsWildcard diz se o endereço escuta em todas as interfaces.
func IsWildcard(addr string) bool {
	return addr == "" || addr == "0.0.0.0" || addr == "::"
}
