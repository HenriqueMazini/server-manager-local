package projects

import (
	"os"
	"path/filepath"
	"testing"

	"servermanager/internal/config"
	"servermanager/internal/model"
)

func TestMarkWorktrees(t *testing.T) {
	root := t.TempDir()
	main := filepath.Join(root, "loja")
	wt := filepath.Join(root, "loja-feature-x")
	detached := filepath.Join(root, "loja-hotfix")
	other := filepath.Join(root, "site")
	for _, d := range []string{filepath.Join(main, ".git", "worktrees", "loja-feature-x"), filepath.Join(main, ".git", "worktrees", "loja-hotfix"), wt, detached, filepath.Join(other, ".git")} {
		must(t, os.MkdirAll(d, 0o755))
	}
	must(t, os.WriteFile(filepath.Join(wt, ".git"), []byte("gitdir: "+filepath.Join(main, ".git", "worktrees", "loja-feature-x")+"\n"), 0o644))
	must(t, os.WriteFile(filepath.Join(main, ".git", "worktrees", "loja-feature-x", "HEAD"), []byte("ref: refs/heads/feat/campanhas\n"), 0o644))
	must(t, os.WriteFile(filepath.Join(detached, ".git"), []byte("gitdir: "+filepath.Join(main, ".git", "worktrees", "loja-hotfix")+"\n"), 0o644))
	must(t, os.WriteFile(filepath.Join(main, ".git", "worktrees", "loja-hotfix", "HEAD"), []byte("0123456789abcdef0123456789abcdef01234567\n"), 0o644))

	cfg := config.Config{Projects: map[string]config.ProjectCfg{"loja": {Name: "Loja", Dir: main}}}
	ps := []model.Project{
		{Key: "loja", Name: "Loja", Kind: "configured", Dir: main},
		{Key: "loja-feature-x", Kind: "compose", Dir: wt},
		{Key: "loja-hotfix", Kind: "compose", Dir: detached},
		{Key: "loja-velha", Kind: "compose", Dir: filepath.Join(root, "loja-velha")}, // pasta apagada
		{Key: "site", Kind: "compose", Dir: other},
		{Key: "loja-sobra", Kind: "compose", Dir: filepath.Join(root, "loja-sobra")}, // pasta recriada pelo Docker, sem .git
		{Key: "lojinha", Kind: "compose", Dir: filepath.Join(root, "lojinha")},       // nome parecido, mas sem hífen: não é worktree
	}
	must(t, os.MkdirAll(filepath.Join(root, "loja-sobra", "storage"), 0o755))
	must(t, os.MkdirAll(filepath.Join(root, "lojinha"), 0o755))
	markWorktrees(ps, cfg)
	if ps[0].Worktree != nil || ps[4].Worktree != nil {
		t.Error("projeto principal e repositório comum não são worktree")
	}
	w := ps[1].Worktree
	if w == nil || w.MainDir != main || w.MainName != "Loja" || w.MainKey != "loja" || w.Branch != "feat/campanhas" || w.Missing {
		t.Fatalf("worktree = %+v", w)
	}
	if ps[2].Worktree == nil || ps[2].Worktree.Branch != "0123456" {
		t.Errorf("HEAD solto = %+v", ps[2].Worktree)
	}
	if ps[3].Worktree == nil || !ps[3].Worktree.Missing || ps[3].Worktree.MainName != "Loja" {
		t.Errorf("worktree apagada = %+v", ps[3].Worktree)
	}
	if ps[5].Worktree == nil || !ps[5].Worktree.Missing {
		t.Errorf("pasta recriada pelo Docker = %+v", ps[5].Worktree)
	}
	if ps[6].Worktree != nil {
		t.Errorf("lojinha não é worktree de loja: %+v", ps[6].Worktree)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
