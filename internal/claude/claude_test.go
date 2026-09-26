package claude

import (
	"os"
	"path/filepath"
	"testing"
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

	must(t, os.WriteFile(filepath.Join(sessDir, "200.json"), []byte(`{"pid":200,"cwd":"/home/u/projetos/loja","name":"loja","status":"busy","version":"2.1.281","startedAt":1790000000000,"procStart":"777"}`), 0o644))
	// PID 300 reaproveitado: arquivo de outra sessão, com início diferente.
	must(t, os.WriteFile(filepath.Join(sessDir, "300.json"), []byte(`{"pid":300,"name":"velha","status":"idle","procStart":"1"}`), 0o644))
	// Sessão encerrada: arquivo sem processo.
	must(t, os.WriteFile(filepath.Join(sessDir, "999.json"), []byte(`{"pid":999,"name":"morta","procStart":"5"}`), 0o644))

	s := Read(procDir, sessDir, "/home/u")
	if !s.Available || len(s.Sessions) != 2 {
		t.Fatalf("esperava 2 sessões (o claude filho é subagente): %+v", s)
	}
	a := s.Sessions[0]
	if a.Name != "loja" || a.Cwd != "~/projetos/loja" || a.Status != "busy" || a.Version != "2.1.281" {
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
