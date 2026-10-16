// Server Manager: painel local para ligar e desligar os containers Docker da máquina.
package main

import (
	"context"
	_ "embed"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"servermanager/internal/config"
	"servermanager/internal/dockerx"
	"servermanager/internal/httpapi"
	"servermanager/internal/labels"
	"servermanager/internal/state"
	"servermanager/internal/version"
	"servermanager/web"
)

//go:embed VERSION
var versionFile string

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	version.Set(versionFile)
	addr := env("SM_ADDR", "127.0.0.1:9090")
	cfgPath := env("SM_CONFIG", "services.yml")
	// Pasta gravável do painel (apelidos). No container é /data, montada a partir de ./data.
	dataDir := env("SM_DATA_DIR", "data")

	if _, p, err := net.SplitHostPort(addr); err == nil {
		if n, err := strconv.ParseUint(p, 10, 16); err == nil {
			state.SelfPort = uint16(n)
		}
	}

	dc, err := dockerx.New()
	if err != nil {
		slog.Error("não foi possível criar o cliente Docker", "err", err)
		os.Exit(1)
	}
	defer dc.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	lb := labels.New(filepath.Join(dataDir, "apelidos.json"))
	st := state.New(dc, config.NewLoader(cfgPath), lb)
	go st.Run(ctx)

	srv := &http.Server{
		Addr:              addr,
		Handler:           httpapi.Handler(st, dc, lb, web.FS()),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()

	slog.Info("Server Manager no ar", "versao", version.Current, "url", "http://"+addr, "config", cfgPath)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("servidor parou", "err", err)
		os.Exit(1)
	}
}
