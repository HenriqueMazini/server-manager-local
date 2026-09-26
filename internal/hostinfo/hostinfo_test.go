package hostinfo

import (
	"strings"
	"testing"
)

const tcpFixture = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:0277 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 1 0000000000000000 100 0 0 10 0
   1: 00000000:1538 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2 1 0000000000000000 100 0 0 10 0
   2: 0100007F:1538 0100007F:C350 01 00000000:00000000 00:00000000 00000000  1000        0 3 1 0000000000000000 20 4 30 10 -1
`

const tcp6Fixture = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:1538 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 4 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000001000000:0277 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 5 1 0000000000000000 100 0 0 10 0
`

func TestParseListeners(t *testing.T) {
	ls, err := ParseListeners(strings.NewReader(tcpFixture))
	if err != nil {
		t.Fatal(err)
	}
	if len(ls) != 2 {
		t.Fatalf("esperava 2 listeners (a linha ESTABLISHED sai), veio %d", len(ls))
	}
	if ls[0].Addr != "127.0.0.1" || ls[0].Port != 631 {
		t.Errorf("primeiro listener = %+v", ls[0])
	}
	if ls[1].Addr != "0.0.0.0" || ls[1].Port != 5432 {
		t.Errorf("segundo listener = %+v", ls[1])
	}
}

func TestParseListenersIPv6AndDedupe(t *testing.T) {
	v4, _ := ParseListeners(strings.NewReader(tcpFixture))
	v6, err := ParseListeners(strings.NewReader(tcp6Fixture))
	if err != nil {
		t.Fatal(err)
	}
	if v6[0].Addr != "::" || v6[1].Addr != "::1" {
		t.Errorf("ipv6 = %+v", v6)
	}
	all := Dedupe(append(v4, v6...))
	if len(all) != 2 {
		t.Fatalf("dedupe deveria deixar 631 e 5432, veio %+v", all)
	}
	if all[1].Port != 5432 || !IsWildcard(all[1].Addr) {
		t.Errorf("5432 deveria manter o curinga: %+v", all[1])
	}
}

func TestParseMem(t *testing.T) {
	in := "MemTotal:       47595208 kB\nMemFree:        28000000 kB\nMemAvailable:   42000000 kB\nBuffers:          100000 kB\nCached:         12000000 kB\nSReclaimable:     900000 kB\nSwapTotal:       8388604 kB\nSwapFree:        8388604 kB\n"
	m, err := ParseMem(strings.NewReader(in))
	if err != nil {
		t.Fatal(err)
	}
	if m.Total != 47595208*1024 || m.Used != (47595208-42000000)*1024 {
		t.Errorf("mem = %+v", m)
	}
	if m.Cached != (12000000+100000+900000)*1024 || m.SwapUsed != 0 {
		t.Errorf("cache/swap = %+v", m)
	}
}
