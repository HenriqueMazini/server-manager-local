package diskx

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"servermanager/internal/model"
)

// Semanas e origens guardadas no histórico.
const (
	keepWeeks   = 12
	keepSources = 20
	// Quanto tempo um volume anônimo recém-criado espera o primeiro "mount" para descobrir a imagem.
	pendingFor = 10 * time.Minute
)

// History conta os volumes anônimos criados por semana e guarda quem os montou primeiro, a partir dos
// eventos do Docker. Fica em um arquivo pequeno na pasta de dados do painel.
type History struct {
	path    string
	mu      sync.Mutex
	data    model.VolumeHistory
	pending map[string]time.Time // volume anônimo criado, esperando o primeiro mount
	now     func() time.Time
}

// NewHistory carrega o histórico de path (ou começa um novo).
func NewHistory(path string) *History {
	h := &History{path: path, pending: map[string]time.Time{}, now: time.Now}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &h.data)
	}
	if h.data.Since.IsZero() {
		h.data.Since = h.now()
	}
	return h
}

// weekOf devolve a segunda-feira da semana de t, como "2026-10-26".
func weekOf(t time.Time) string {
	t = t.Local()
	wd := (int(t.Weekday()) + 6) % 7 // segunda = 0
	return t.AddDate(0, 0, -wd).Format("2006-01-02")
}

// Created registra a criação de um volume. Só conta os anônimos.
func (h *History) Created(name string) {
	if !Anonymous(name) {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	week := weekOf(now)
	found := false
	for i := range h.data.Weeks {
		if h.data.Weeks[i].Week == week {
			h.data.Weeks[i].Count++
			found = true
		}
	}
	if !found {
		h.data.Weeks = append(h.data.Weeks, model.WeekCount{Week: week, Count: 1})
		sort.Slice(h.data.Weeks, func(i, j int) bool { return h.data.Weeks[i].Week < h.data.Weeks[j].Week })
		if len(h.data.Weeks) > keepWeeks {
			h.data.Weeks = h.data.Weeks[len(h.data.Weeks)-keepWeeks:]
		}
	}
	h.pending[name] = now
	for n, t := range h.pending {
		if now.Sub(t) > pendingFor {
			delete(h.pending, n)
		}
	}
	h.save()
}

// Pending diz se o volume foi criado há pouco e ainda não se sabe quem o montou.
func (h *History) Pending(name string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.pending[name]
	return ok
}

// Mounted registra quem montou um volume anônimo recém-criado: a imagem do container e a origem
// (projeto do compose ou ferramenta de testes).
func (h *History) Mounted(name, image, origin, dir string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.pending[name]; !ok {
		return
	}
	delete(h.pending, name)
	now := h.now()
	for i := range h.data.Sources {
		s := &h.data.Sources[i]
		if s.Image == image && s.Origin == origin {
			s.Count++
			s.Last = now
			if dir != "" {
				s.Dir = dir
			}
			h.save()
			return
		}
	}
	h.data.Sources = append(h.data.Sources, model.VolumeSource{Image: image, Origin: origin, Dir: dir, Count: 1, Last: now})
	sort.Slice(h.data.Sources, func(i, j int) bool { return h.data.Sources[i].Count > h.data.Sources[j].Count })
	if len(h.data.Sources) > keepSources {
		h.data.Sources = h.data.Sources[:keepSources]
	}
	h.save()
}

// Snapshot devolve uma cópia do histórico.
func (h *History) Snapshot() model.VolumeHistory {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := model.VolumeHistory{Since: h.data.Since, Weeks: append([]model.WeekCount{}, h.data.Weeks...), Sources: append([]model.VolumeSource{}, h.data.Sources...)}
	sort.Slice(out.Sources, func(i, j int) bool { return out.Sources[i].Count > out.Sources[j].Count })
	return out
}

func (h *History) save() {
	if h.path == "" {
		return
	}
	b, err := json.MarshalIndent(h.data, "", "  ")
	if err != nil {
		return
	}
	tmp := h.path + ".tmp"
	if err := os.MkdirAll(filepath.Dir(h.path), 0o755); err != nil {
		return
	}
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		slog.Warn("histórico de volumes", "err", err)
		return
	}
	_ = os.Rename(tmp, h.path)
}
