package projects

import (
	"os"
	"path/filepath"
	"strings"

	"servermanager/internal/config"
	"servermanager/internal/model"
)

// worktreeOf diz se dir é uma worktree do git: nela, .git é um arquivo
// "gitdir: <repo>/.git/worktrees/<nome>". Devolve a pasta do repositório principal e a branch.
func worktreeOf(dir string) (mainDir, branch string, ok bool) {
	b, err := os.ReadFile(filepath.Join(dir, ".git"))
	if err != nil {
		return "", "", false // pasta comum (.git é diretório) ou sem git
	}
	gitdir, found := strings.CutPrefix(strings.TrimSpace(string(b)), "gitdir:")
	if !found {
		return "", "", false
	}
	gitdir = strings.TrimSpace(gitdir)
	if !filepath.IsAbs(gitdir) {
		gitdir = filepath.Join(dir, gitdir)
	}
	i := strings.Index(gitdir, string(filepath.Separator)+".git"+string(filepath.Separator)+"worktrees"+string(filepath.Separator))
	if i < 0 {
		return "", "", false // submódulo, não worktree
	}
	mainDir = gitdir[:i]
	if head, err := os.ReadFile(filepath.Join(gitdir, "HEAD")); err == nil {
		branch = strings.TrimPrefix(strings.TrimSpace(string(head)), "ref: refs/heads/")
		if len(branch) == 40 && !strings.Contains(branch, "/") {
			branch = branch[:7] // HEAD solto: mostra o commit curto
		}
	}
	return mainDir, branch, true
}

// isGitRepo diz se dir é um repositório principal (.git é diretório).
func isGitRepo(dir string) bool {
	st, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil && st.IsDir()
}

// markWorktrees marca os projetos compose que vêm de worktrees, ligando cada um ao projeto principal.
// Uma worktree já apagada do disco (containers sobraram) é reconhecida pelo nome: a pasta irmã cujo
// nome é o prefixo e que é um repositório git.
func markWorktrees(ps []model.Project, cfg config.Config) {
	names := map[string]string{} // pasta -> nome no painel
	keys := map[string]string{}
	for key, p := range cfg.Projects {
		if d := config.ExpandPath(p.Dir, ""); d != "" {
			names[d] = p.Name
			keys[d] = key
			if p.Name == "" {
				names[d] = key
			}
		}
	}
	for _, p := range ps {
		if p.Dir != "" {
			if _, ok := names[p.Dir]; !ok {
				names[p.Dir], keys[p.Dir] = p.Name, p.Key
			}
		}
	}
	for i := range ps {
		p := &ps[i]
		if p.Kind != "compose" || p.Dir == "" {
			continue
		}
		mainDir, branch, ok := worktreeOf(p.Dir)
		missing := false
		if !ok {
			// Worktree já removida do git: a pasta sumiu, ou só sobrou o que o Docker recriou ao
			// reiniciar os containers (sem .git). Repositórios comuns têm .git e ficam de fora.
			if _, err := os.Stat(filepath.Join(p.Dir, ".git")); err == nil {
				continue
			}
			mainDir, ok = staleMain(p.Dir)
			missing = ok
		}
		if !ok || mainDir == p.Dir {
			continue
		}
		name := names[mainDir]
		if name == "" {
			name = filepath.Base(mainDir)
		}
		p.Worktree = &model.Worktree{MainDir: mainDir, MainName: name, MainKey: keys[mainDir], Branch: branch, Missing: missing}
	}
}

func staleMain(dir string) (string, bool) {
	parent, base := filepath.Dir(dir), filepath.Base(dir)
	entries, err := os.ReadDir(parent)
	if err != nil {
		return "", false
	}
	best := ""
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() && strings.HasPrefix(base, n+"-") && len(n) > len(filepath.Base(best)) && isGitRepo(filepath.Join(parent, n)) {
			best = filepath.Join(parent, n)
		}
	}
	return best, best != ""
}
