// Package httpapi expõe a API JSON, o stream SSE e o painel embutido.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"servermanager/internal/analyze"
	"servermanager/internal/config"
	"servermanager/internal/control"
	"servermanager/internal/dockerx"
	"servermanager/internal/state"
	"servermanager/internal/version"
)

// ActionHeader precisa vir em toda ação. Um site qualquer não consegue enviá-lo sem CORS,
// então outra aba do navegador não liga nem desliga containers por você.
const ActionHeader = "X-Server-Manager"

// Handler monta todas as rotas.
func Handler(st *state.Store, dc *dockerx.Client, web fs.FS) http.Handler {
	a := &api{st: st, dc: dc}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", a.health)
	mux.HandleFunc("GET /api/snapshot", a.snapshot)
	mux.HandleFunc("GET /api/version", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"version": version.Current})
	})
	mux.HandleFunc("GET /api/events", a.events)
	mux.HandleFunc("GET /api/ports", a.ports)
	mux.HandleFunc("POST /api/projects/{key}/{action}", a.projectAction)
	mux.HandleFunc("GET /api/containers/{id}/logs", a.logs)
	mux.HandleFunc("POST /api/analyze", a.analyze)
	mux.HandleFunc("GET /api/folders", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, analyze.ListFolders(ProjectsRoot, a.st.Config()))
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "rota não encontrada"})
	})
	mux.Handle("/", spa(web))
	return localOnly(mux)
}

type api struct {
	st *state.Store
	dc *dockerx.Client
}

func (a *api) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := a.dc.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "docker indisponível", "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": version.Current})
}

func (a *api) snapshot(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.st.Snapshot())
}

func (a *api) ports(w http.ResponseWriter, _ *http.Request) {
	s := a.st.Snapshot()
	writeJSON(w, http.StatusOK, map[string]any{"ports": s.Ports, "listeners": s.Listeners, "conflicts": s.Conflicts})
}

func (a *api) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming não suportado", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	ch, cancel := a.st.Subscribe()
	defer cancel()

	send := func(v any) bool {
		b, err := json.Marshal(v)
		if err != nil {
			return false
		}
		if _, err := w.Write([]byte("event: snapshot\ndata: ")); err != nil {
			return false
		}
		if _, err := w.Write(append(b, '\n', '\n')); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	if !send(a.st.Snapshot()) {
		return
	}
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case s := <-ch:
			if !send(s) {
				return
			}
		case <-ping.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// actionCtx não morre se o navegador fechar: um stop pela metade é pior que um stop lento.
func actionCtx(r *http.Request) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(r.Context()), 3*time.Minute)
}

func (a *api) projectAction(w http.ResponseWriter, r *http.Request) {
	action := r.PathValue("action")
	if action != "start" && action != "stop" && action != "restart" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "ação inválida"})
		return
	}
	p, ok := a.st.Project(r.PathValue("key"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "projeto não encontrado"})
		return
	}
	ctx, cancel := actionCtx(r)
	defer cancel()

	var results []control.Result
	switch action {
	case "start":
		results = control.Start(ctx, a.dc, a.st.Config(), p)
	case "restart":
		results = control.Restart(ctx, a.dc, a.st.Config(), p)
	default:
		results = control.Stop(ctx, a.dc, p)
	}
	a.st.Poke()

	var failed []string
	for _, res := range results {
		if !res.OK {
			failed = append(failed, res.Name+": "+res.Error)
		}
	}
	if len(failed) > 0 {
		writeJSON(w, http.StatusBadGateway, map[string]any{"results": results, "error": strings.Join(failed, "; ")})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// ProjectsRoot é a pasta onde ficam os projetos. Padrão: ~/projetos. O painel só lê e nunca a cria.
var ProjectsRoot = projectsRoot()

func projectsRoot() string {
	if v := os.Getenv("SM_PROJECTS_ROOT"); v != "" {
		return filepath.Clean(v)
	}
	return filepath.Join(config.HostHome, "projetos")
}

func (a *api) analyze(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "corpo inválido"})
		return
	}
	res, err := analyze.Run(body.Path, ProjectsRoot, a.st.Snapshot(), a.st.Config())
	if errors.Is(err, analyze.ErrInput) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *api) logs(w http.ResponseWriter, r *http.Request) {
	c, ok := a.st.Item(r.PathValue("id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "container não encontrado"})
		return
	}
	tail := 300
	if n, err := strconv.Atoi(r.URL.Query().Get("tail")); err == nil && n > 0 && n <= 5000 {
		tail = n
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	out, err := a.dc.Logs(ctx, c.ID, tail)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(out))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// localOnly recusa Host estranho (DNS rebinding) e ações sem o header do painel (CSRF).
func localOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		switch host {
		case "localhost", "127.0.0.1", "::1", "[::1]":
		default:
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "acesso permitido só por localhost"})
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get(ActionHeader) != "1" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "ação sem o header " + ActionHeader})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// spa serve os arquivos do build e devolve index.html para qualquer outra rota.
func spa(web fs.FS) http.Handler {
	files := http.FileServerFS(web)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(web, "index.html"); err != nil {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("<!doctype html><title>Server Manager</title><p>O painel não foi compilado. Rode <code>npm run build</code> em <code>web/</code> ou suba com <code>docker compose up -d --build</code>.</p>"))
			return
		}
		st, err := fs.Stat(web, p)
		if err != nil || st.IsDir() {
			if errors.Is(err, fs.ErrNotExist) || err == nil {
				w.Header().Set("Cache-Control", "no-cache")
				http.ServeFileFS(w, r, web, "index.html")
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if strings.HasPrefix(p, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})
}
