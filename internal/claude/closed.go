package claude

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// ClosedSession é uma conversa guardada em ~/.claude/projects sem processo aberto.
type ClosedSession struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Cwd       string    `json:"cwd,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
	Size      int64     `json:"size"`
}

var (
	uuidFile   = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$`)
	titleField = regexp.MustCompile(`"(?:customTitle|agentName)":"((?:[^"\\]|\\.)*)"`)
	cwdField   = regexp.MustCompile(`"cwd":"((?:[^"\\]|\\.)*)"`)
)

// headBytes e tailBytes limitam a leitura: conversas chegam a dezenas de MB.
const (
	headBytes = 256 << 10
	tailBytes = 128 << 10
)

type cacheEntry struct {
	mod  time.Time
	size int64
	s    ClosedSession
}

var (
	cacheMu sync.Mutex
	cache   = map[string]cacheEntry{}
)

// Closed lista as conversas de projectsDir (~/.claude/projects) que não estão abertas agora.
// Lê só o começo (pasta) e o fim (nome) de cada arquivo e guarda o resultado até o arquivo mudar.
func Closed(projectsDir, home string, open map[string]bool) []ClosedSession {
	files, _ := filepath.Glob(filepath.Join(projectsDir, "*", "*.jsonl"))
	out := []ClosedSession{}
	seen := map[string]bool{}
	cacheMu.Lock()
	defer cacheMu.Unlock()
	for _, f := range files {
		if !uuidFile.MatchString(filepath.Base(f)) {
			continue
		}
		id := strings.TrimSuffix(filepath.Base(f), ".jsonl")
		seen[f] = true
		if open[id] {
			continue
		}
		st, err := os.Stat(f)
		if err != nil || st.Size() == 0 {
			continue
		}
		c, ok := cache[f]
		if !ok || !c.mod.Equal(st.ModTime()) || c.size != st.Size() {
			c = cacheEntry{mod: st.ModTime(), size: st.Size(), s: readClosed(f, id, home)}
			c.s.UpdatedAt, c.s.Size = st.ModTime(), st.Size()
			cache[f] = c
		}
		out = append(out, c.s)
	}
	for f := range cache {
		if !seen[f] {
			delete(cache, f)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out
}

func readClosed(path, id, home string) ClosedSession {
	s := ClosedSession{ID: id, Name: id[:8]}
	f, err := os.Open(path)
	if err != nil {
		return s
	}
	defer f.Close()
	head := make([]byte, headBytes)
	n, _ := io.ReadFull(f, head)
	if m := cwdField.FindSubmatch(head[:n]); m != nil {
		s.Cwd = shorten(unquote(m[1]), home)
	} else {
		s.Cwd = shorten(dirToPath(filepath.Base(filepath.Dir(path))), home)
	}
	if st, err := f.Stat(); err == nil {
		start := st.Size() - tailBytes
		if start < 0 {
			start = 0
		}
		tail := make([]byte, st.Size()-start)
		if _, err := f.ReadAt(tail, start); err == nil || err == io.EOF {
			if ms := titleField.FindAllSubmatch(tail, -1); len(ms) > 0 {
				if t := unquote(ms[len(ms)-1][1]); t != "" {
					s.Name = t
				}
			}
		}
	}
	return s
}

func unquote(b []byte) string {
	var s string
	if err := json.Unmarshal(append(append([]byte{'"'}, b...), '"'), &s); err != nil {
		return string(bytes.ReplaceAll(b, []byte(`\"`), []byte(`"`)))
	}
	return s
}

// dirToPath reverte o nome de pasta do Claude Code ("-home-u-projetos-loja"). É aproximado:
// hífens do nome original também viram barras. Só é usado quando o arquivo não traz a pasta.
func dirToPath(dir string) string {
	return strings.ReplaceAll(dir, "-", "/")
}
