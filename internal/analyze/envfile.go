package analyze

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// envNames são os arquivos de ambiente lidos em desenvolvimento, na ordem de prioridade crescente.
var envNames = []string{".env", ".env.development", ".env.local", ".env.development.local"}

// readEnv lê um arquivo KEY=VALUE. Devolve nil se o arquivo não existe.
func readEnv(path string) map[string]string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	out := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') && v[len(v)-1] == v[0] {
			v = v[1 : len(v)-1]
		} else if i := strings.Index(v, " #"); i >= 0 {
			v = strings.TrimSpace(v[:i])
		}
		out[k] = v
	}
	return out
}

// envFile é um arquivo de ambiente encontrado no projeto.
type envFile struct {
	Path string
	Vars map[string]string
}

// dirEnv junta os arquivos de ambiente de desenvolvimento de uma pasta.
func dirEnv(dir string) (merged map[string]string, files []envFile) {
	merged = map[string]string{}
	for _, n := range envNames {
		p := filepath.Join(dir, n)
		if vars := readEnv(p); vars != nil {
			files = append(files, envFile{Path: p, Vars: vars})
			for k, v := range vars {
				merged[k] = v
			}
		}
	}
	return merged, files
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
