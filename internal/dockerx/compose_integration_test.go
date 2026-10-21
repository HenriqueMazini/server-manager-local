package dockerx

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// Teste de integração com o Docker real. Rodar: SM_DOCKER_TEST=1 go test ./internal/dockerx/
func TestRemoveComposeProject(t *testing.T) {
	if os.Getenv("SM_DOCKER_TEST") != "1" {
		t.Skip("defina SM_DOCKER_TEST=1 para rodar contra o Docker")
	}
	const proj = "sm-teste-remocao"
	sh := func(args ...string) string {
		out, err := exec.Command("docker", args...).CombinedOutput()
		if err != nil {
			t.Fatalf("docker %v: %v\n%s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	label := "com.docker.compose.project=" + proj
	sh("network", "create", "--label", label, proj+"_default")
	sh("volume", "create", "--label", label, proj+"_dados")
	sh("run", "-d", "--name", proj+"-a", "--label", label, "--network", proj+"_default", "-v", proj+"_dados:/d", "alpine:3.22", "sleep", "300")
	sh("create", "--name", proj+"-b", "--label", label, "alpine:3.22", "true")
	sh("run", "-d", "--name", "sm-teste-vizinho", "alpine:3.22", "sleep", "300") // fora do projeto
	defer exec.Command("docker", "rm", "-f", "sm-teste-vizinho", proj+"-a", proj+"-b").Run()
	defer exec.Command("docker", "network", "rm", proj+"_default").Run()
	defer exec.Command("docker", "volume", "rm", proj+"_dados").Run()

	c, err := New()
	if err != nil {
		t.Fatal(err)
	}
	r := c.RemoveComposeProject(context.Background(), proj, false)
	if r.Containers != 2 || r.Networks != 1 || r.Volumes != 0 || len(r.Errors) > 0 {
		t.Fatalf("sem volumes = %+v", r)
	}
	if out, _ := exec.Command("docker", "volume", "inspect", proj+"_dados").CombinedOutput(); strings.Contains(string(out), "no such volume") {
		t.Fatal("o volume não podia sair sem pedir")
	}
	if sh("ps", "-q", "--filter", "name=sm-teste-vizinho") == "" {
		t.Fatal("container de fora do projeto foi removido")
	}
	r = c.RemoveComposeProject(context.Background(), proj, true)
	if r.Volumes != 1 || len(r.Errors) > 0 {
		t.Fatalf("com volumes = %+v", r)
	}
}
