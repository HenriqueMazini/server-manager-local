package labels

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSetAndAll(t *testing.T) {
	path := filepath.Join(t.TempDir(), "apelidos.json")
	s := New(path)
	if len(s.All()) != 0 {
		t.Fatal("arquivo ausente vale como vazio")
	}
	got, err := s.Set("vendas", "  Loja\n")
	if err != nil || got != "Loja" {
		t.Fatalf("Set = %q %v", got, err)
	}
	if _, err := s.Set("loja", "Loja antiga"); err != nil {
		t.Fatal(err)
	}
	all := New(path).All()
	if all["vendas"] != "Loja" || all["loja"] != "Loja antiga" {
		t.Errorf("All = %v", all)
	}
	if _, err := s.Set("loja", "   "); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.All()["loja"]; ok {
		t.Error("apelido vazio remove")
	}
	if _, err := s.Set("x", strings.Repeat("a", MaxLen+1)); err != ErrTooLong {
		t.Errorf("apelido longo: %v", err)
	}
	if entries, _ := os.ReadDir(filepath.Dir(path)); len(entries) != 1 {
		t.Errorf("gravação atômica não pode deixar temporários: %v", entries)
	}
}

func TestReadOnlyDir(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(dir, 0o755)
	if _, err := New(filepath.Join(dir, "apelidos.json")).Set("a", "b"); err == nil || !strings.Contains(err.Error(), "install.sh") {
		t.Errorf("pasta sem escrita deve explicar o que fazer: %v", err)
	}
}
