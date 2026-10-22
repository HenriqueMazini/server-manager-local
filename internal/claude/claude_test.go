package claude

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fakeProc(t *testing.T, root string, pid, ppid int, comm, start string, rssKB int, args string) {
	t.Helper()
	dir := filepath.Join(root, itoa(pid))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Campo 22 (início) é o 20º depois do ")".
	stat := itoa(pid) + " (" + comm + ") S " + itoa(ppid) + " 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 " + start + " 0 0\n"
	must(t, os.WriteFile(filepath.Join(dir, "stat"), []byte(stat), 0o644))
	must(t, os.WriteFile(filepath.Join(dir, "status"), []byte("Name:\t"+comm+"\nVmRSS:\t"+itoa(rssKB)+" kB\n"), 0o644))
	must(t, os.WriteFile(filepath.Join(dir, "cmdline"), []byte(args), 0o644))
}

func itoa(n int) string { return fmtInt(n) }

func fmtInt(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func TestRead(t *testing.T) {
	root := t.TempDir()
	procDir := filepath.Join(root, "proc")
	sessDir := filepath.Join(root, "sessions")
	must(t, os.MkdirAll(sessDir, 0o755))

	fakeProc(t, procDir, 1, 0, "systemd", "1", 10000, "/sbin/init")
	fakeProc(t, procDir, 100, 1, "bash", "50", 5000, "bash")
	fakeProc(t, procDir, 200, 100, "claude", "777", 400000, "claude\x00-c")
	fakeProc(t, procDir, 201, 200, "MainThread", "780", 70000, "node\x00/home/u/.claude/mcp/state-server/dist/index.js")
	fakeProc(t, procDir, 202, 200, "bash", "790", 3000, "bash\x00-c\x00npm test")
	fakeProc(t, procDir, 203, 202, "node", "791", 100000, "node\x00jest")
	fakeProc(t, procDir, 204, 200, "claude", "792", 200000, "claude\x00--subagent")
	fakeProc(t, procDir, 300, 100, "claude", "900", 350000, "claude")
	fakeProc(t, procDir, 400, 1, "claude", "950", 90000, "/home/u/.local/bin/claude\x00daemon\x00run\x00--json-path\x00x")

	must(t, os.WriteFile(filepath.Join(sessDir, "200.json"), []byte(`{"pid":200,"cwd":"/home/u/projetos/loja","name":"loja","status":"busy","version":"2.1.281","startedAt":1790000000000,"updatedAt":1790000500000,"procStart":"777"}`), 0o644))
	// PID 300 reaproveitado: arquivo de outra sessão, com início diferente.
	must(t, os.WriteFile(filepath.Join(sessDir, "300.json"), []byte(`{"pid":300,"name":"velha","status":"idle","procStart":"1"}`), 0o644))
	// Sessão encerrada: arquivo sem processo.
	must(t, os.WriteFile(filepath.Join(sessDir, "999.json"), []byte(`{"pid":999,"name":"morta","procStart":"5"}`), 0o644))

	s := Read(procDir, sessDir, "/home/u")
	if !s.Available || len(s.Sessions) != 2 {
		t.Fatalf("esperava 2 sessões (o claude filho é subagente): %+v", s)
	}
	a := s.Sessions[0]
	if a.Name != "loja" || a.Cwd != "~/projetos/loja" || a.Status != "busy" || a.Version != "2.1.281" || a.UpdatedAt.UnixMilli() != 1790000500000 {
		t.Errorf("metadados = %+v", a)
	}
	want := uint64(400000+70000+3000+100000+200000) * 1024
	if a.MemUsed != want || a.Procs != 5 {
		t.Errorf("memória da árvore = %d (%d processos), quero %d", a.MemUsed, a.Procs, want)
	}
	if a.Children[0].Name != "claude --subagent" || a.Children[2].Name != "MCP state-server" {
		t.Errorf("filhos = %+v", a.Children)
	}
	b := s.Sessions[1]
	if b.Name != "claude" || b.Status != "unknown" || b.Cwd != "" {
		t.Errorf("PID reaproveitado não herda metadados: %+v", b)
	}
	if s.MemUsed != want+350000*1024 {
		t.Errorf("total = %d", s.MemUsed)
	}
}

func TestReadWithoutProc(t *testing.T) {
	if s := Read(filepath.Join(t.TempDir(), "nada"), "", ""); s.Available || len(s.Sessions) != 0 {
		t.Errorf("sem /proc não há sessões: %+v", s)
	}
}

func TestSortSessions(t *testing.T) {
	at := func(m int64) time.Time { return time.UnixMilli(m) }
	ss := []Session{
		{PID: 1, Name: "ociosa-antiga", Status: "idle", UpdatedAt: at(100)},
		{PID: 2, Name: "trabalhando-antiga", Status: "busy", UpdatedAt: at(200)},
		{PID: 3, Name: "aguardando-recente", Status: "waiting", UpdatedAt: at(900)},
		{PID: 4, Name: "trabalhando-recente", Status: "busy", UpdatedAt: at(800)},
		{PID: 5, Name: "sem-metadados", Status: "unknown"},
	}
	sortSessions(ss)
	var got []string
	for _, s := range ss {
		got = append(got, s.Name)
	}
	want := []string{"trabalhando-recente", "trabalhando-antiga", "aguardando-recente", "ociosa-antiga", "sem-metadados"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("ordem = %v, quero %v", got, want)
		}
	}
}

func TestClosed(t *testing.T) {
	root := t.TempDir()
	proj := filepath.Join(root, "projects", "-home-u-loja")
	must(t, os.MkdirAll(filepath.Join(proj, "11111111-1111-1111-1111-111111111111", "subagents"), 0o755))
	write := func(name, content string) string {
		p := filepath.Join(proj, name)
		must(t, os.WriteFile(p, []byte(content), 0o644))
		return p
	}
	// Fechada, com pasta no começo e nome no fim (o último vale).
	big := `{"type":"mode"}` + "\n" + `{"type":"user","cwd":"/home/u/projetos/loja"}` + "\n" + strings.Repeat(`{"type":"assistant","x":"`+strings.Repeat("a", 1000)+`"}`+"\n", 400) +
		`{"type":"custom-title","customTitle":"nome-antigo"}` + "\n" + `{"type":"agent-name","agentName":"loja-api"}` + "\n"
	a := write("22222222-2222-2222-2222-222222222222.jsonl", big)
	// Aberta agora: não entra.
	write("33333333-3333-3333-3333-333333333333.jsonl", `{"cwd":"/x"}`+"\n")
	// Sem nome nem pasta: usa o começo do ID e a pasta do diretório.
	b := write("44444444-4444-4444-4444-444444444444.jsonl", `{"type":"mode"}`+"\n")
	// Arquivo que não é conversa.
	write("anotacoes.jsonl", "{}\n")
	old := time.Now().Add(-time.Hour)
	must(t, os.Chtimes(b, old, old))

	got := Closed(filepath.Join(root, "projects"), "/home/u", map[string]bool{"33333333-3333-3333-3333-333333333333": true})
	if len(got) != 2 {
		t.Fatalf("esperava 2 fechadas: %+v", got)
	}
	if got[0].ID != "22222222-2222-2222-2222-222222222222" || got[0].Name != "loja-api" || got[0].Cwd != "~/projetos/loja" {
		t.Errorf("primeira (mais recente) = %+v", got[0])
	}
	if got[1].Name != "44444444" || got[1].Cwd != "~/loja" {
		t.Errorf("sem metadados = %+v", got[1])
	}
	// Cache: arquivo alterado é relido.
	must(t, os.WriteFile(a, []byte(`{"cwd":"/home/u/outra"}`+"\n"+`{"agentName":"renomeada"}`+"\n"), 0o644))
	got = Closed(filepath.Join(root, "projects"), "/home/u", nil)
	if got[0].Name != "renomeada" || got[0].Cwd != "~/outra" {
		t.Errorf("cache não releu o arquivo alterado: %+v", got[0])
	}
}

func TestCwdGone(t *testing.T) {
	home := t.TempDir()
	viva := filepath.Join(home, "projetos", "loja")
	must(t, os.MkdirAll(viva, 0o755))
	if dirGone(viva, home) {
		t.Error("pasta existente marcada como apagada")
	}
	if !dirGone(filepath.Join(home, "projetos", "loja-feature"), home) {
		t.Error("pasta apagada não detectada")
	}
	// Sem a pasta pessoal visível, não afirma nada.
	if dirGone("/nao/existe", filepath.Join(home, "sem-home")) {
		t.Error("marcou como apagada sem enxergar a pasta pessoal")
	}
	if dirGone("", home) {
		t.Error("pasta vazia marcada como apagada")
	}
}

func TestSessionWithoutDates(t *testing.T) {
	b, err := json.Marshal(Session{PID: 1, Name: "x"})
	must(t, err)
	if strings.Contains(string(b), "updatedAt") || strings.Contains(string(b), "startedAt") {
		t.Errorf("datas vazias não devem ir no JSON: %s", b)
	}
}
