package state

import (
	"context"
	"log/slog"
	"path/filepath"
	"sync"
	"time"

	"servermanager/internal/diskx"
	"servermanager/internal/dockerx"
	"servermanager/internal/model"
)

// DiskCacheFor é quanto tempo o relatório de disco do Docker vale antes de ser recalculado.
const DiskCacheFor = 5 * time.Minute

// VolumeHistoryFile guarda os volumes anônimos criados por semana. main define a partir de SM_DATA_DIR.
var VolumeHistoryFile = filepath.Join("data", "volumes.json")

// Disk calcula o que o Docker ocupa no disco sob demanda, com cache, e acompanha a criação de volumes.
type Disk struct {
	dc      *dockerx.Client
	history *diskx.History
	mu      sync.Mutex
	report  model.DockerDisk
	running chan struct{} // fechado quando o cálculo em andamento termina
}

func newDisk(dc *dockerx.Client) *Disk {
	return &Disk{dc: dc, history: diskx.NewHistory(VolumeHistoryFile)}
}

// Report devolve o relatório guardado, ou calcula um novo se passou de DiskCacheFor (ou refresh).
// Pedidos ao mesmo tempo esperam o mesmo cálculo.
func (d *Disk) Report(ctx context.Context, refresh bool) model.DockerDisk {
	d.mu.Lock()
	if !refresh && !d.report.At.IsZero() && time.Since(d.report.At) < DiskCacheFor {
		r := d.report
		d.mu.Unlock()
		r.History = d.history.Snapshot()
		return r
	}
	wait := d.running
	if wait == nil {
		d.running = make(chan struct{})
		wait = d.running
		go d.compute(wait)
	}
	d.mu.Unlock()
	select {
	case <-wait:
	case <-ctx.Done():
	}
	d.mu.Lock()
	r := d.report
	d.mu.Unlock()
	r.History = d.history.Snapshot()
	return r
}

func (d *Disk) compute(done chan struct{}) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	du, err := d.dc.DiskUsage(ctx)
	r := diskx.Classify(du, time.Now())
	if err != nil {
		r.Error = "não deu para ler o uso de disco do Docker: " + err.Error()
	}
	d.mu.Lock()
	d.report = r
	d.running = nil
	d.mu.Unlock()
	close(done)
}

// Invalidate faz o próximo pedido recalcular (depois de uma limpeza).
func (d *Disk) Invalidate() {
	d.mu.Lock()
	d.report.At = time.Time{}
	d.mu.Unlock()
}

// Cached devolve o último relatório sem recalcular.
func (d *Disk) Cached() model.DockerDisk {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.report
}

// watch acompanha criação e montagem de volumes para o histórico.
func (d *Disk) watch(ctx context.Context) {
	d.dc.WatchVolumes(ctx, func(e dockerx.VolumeEvent) {
		switch e.Action {
		case "create":
			d.history.Created(e.Volume)
		case "mount":
			if e.Container == "" || !d.history.Pending(e.Volume) {
				return
			}
			ictx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			image, origin, dir, err := d.dc.ContainerOrigin(ictx, e.Container)
			if err != nil {
				slog.Debug("origem do volume", "err", err)
				return
			}
			d.history.Mounted(e.Volume, image, origin, dir)
		}
	})
}
