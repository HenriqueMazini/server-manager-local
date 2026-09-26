package analyze

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"servermanager/internal/config"
)

// Folder é uma pasta de projeto dentro da pasta de projetos.
type Folder struct {
	Name       string `json:"name"`
	Path       string `json:"path"`                 // como o usuário digita (~/projetos/x)
	Registered string `json:"registered,omitempty"` // nome no painel, se já cadastrado
	Compose    bool   `json:"compose"`
	Node       bool   `json:"node"`
	Git        bool   `json:"git"`
}

// FolderList é a resposta da listagem. Exists=false quando a pasta de projetos não existe:
// nesse caso nada é listado e nada é criado.
type FolderList struct {
	Root    string   `json:"root"`
	Exists  bool     `json:"exists"`
	Folders []Folder `json:"folders"`
}

// ListFolders lista as subpastas diretas de root, só lendo.
func ListFolders(root string, cfg config.Config) FolderList {
	out := FolderList{Root: display(root), Folders: []Folder{}}
	st, err := os.Stat(root)
	if err != nil || !st.IsDir() {
		return out
	}
	out.Exists = true
	registered := map[string]string{}
	for key, p := range cfg.Projects {
		name := p.Name
		if name == "" {
			name = key
		}
		registered[config.ExpandPath(p.Dir, "")] = name
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return out
	}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		dir := filepath.Join(root, e.Name())
		f := Folder{Name: e.Name(), Path: display(dir), Registered: registered[dir], Git: exists(filepath.Join(dir, ".git"))}
		f.Compose = len(composeFiles(dir)) > 0
		f.Node = exists(filepath.Join(dir, "package.json"))
		if !f.Compose || !f.Node {
			walk(dir, 1, func(d string) {
				f.Compose = f.Compose || len(composeFiles(d)) > 0
				f.Node = f.Node || exists(filepath.Join(d, "package.json"))
			})
		}
		out.Folders = append(out.Folders, f)
	}
	sort.Slice(out.Folders, func(i, j int) bool {
		return strings.ToLower(out.Folders[i].Name) < strings.ToLower(out.Folders[j].Name)
	})
	return out
}
