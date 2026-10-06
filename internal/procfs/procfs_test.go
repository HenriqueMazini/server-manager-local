package procfs

import "testing"

func TestAppName(t *testing.T) {
	cases := []struct {
		p    Proc
		want string
	}{
		{Proc{Comm: "chrome", Argv: []string{"/opt/google/chrome/chrome", "--type=renderer"}}, "Google Chrome"},
		{Proc{Comm: "Web Content", Argv: []string{"/usr/lib/firefox/firefox", "-contentproc"}}, "Firefox"},
		{Proc{Comm: "postgres", Argv: []string{"postgres: checkpointer"}}, "PostgreSQL"},
		{Proc{Comm: "next-server (v1", Argv: []string{"next-server (v16.3.1)"}}, "Next.js"},
		{Proc{Comm: "claude", Argv: []string{"claude", "-c"}}, "Claude Code"},
		{Proc{Comm: "kworker/0:1"}, "kworker/0:1"},
		{Proc{Comm: "meuapp", Argv: []string{"./bin/meuapp"}}, "meuapp"},
	}
	for _, c := range cases {
		if got := AppName(c.p); got != c.want {
			t.Errorf("AppName(%v) = %q, quero %q", c.p.Argv, got, c.want)
		}
	}
}

func TestTopApps(t *testing.T) {
	procs := map[int]Proc{
		1: {Comm: "chrome", Argv: []string{"/opt/google/chrome/chrome"}, RSS: 300},
		2: {Comm: "chrome", Argv: []string{"/opt/google/chrome/chrome", "--type=gpu"}, RSS: 200},
		3: {Comm: "code", Argv: []string{"/usr/share/code/code"}, RSS: 400},
		4: {Comm: "node", Argv: []string{"node", "x.js"}, RSS: 100},
		5: {Comm: "bash", Argv: []string{"bash"}, RSS: 10},
		6: {Comm: "kthreadd", RSS: 0},
	}
	top := TopApps(procs, 2)
	if len(top) != 3 || top[0].Name != "Google Chrome" || top[0].MemUsed != 500 || top[0].Procs != 2 || top[1].Name != "VS Code" {
		t.Fatalf("top = %+v", top)
	}
	if top[2].Name != "Outros" || top[2].MemUsed != 110 || top[2].Procs != 2 {
		t.Errorf("outros = %+v", top[2])
	}
}
