package dockerx

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/moby/moby/api/types/events"
	"github.com/moby/moby/client"
)

// DiskUsage é o docker system df detalhado (-v): com centenas de volumes leva alguns segundos.
func (c *Client) DiskUsage(ctx context.Context) (client.DiskUsageResult, error) {
	return c.cli.DiskUsage(ctx, client.DiskUsageOptions{Containers: true, Images: true, BuildCache: true, Volumes: true, Verbose: true})
}

// PruneBuildCache apaga o cache de build sem uso. all=false é o docker builder prune padrão, que
// mantém o cache ainda útil; all=true (-a) apaga todo o cache sem uso, e os próximos builds demoram mais.
func (c *Client) PruneBuildCache(ctx context.Context, all bool) (uint64, int, error) {
	res, err := c.cli.BuildCachePrune(ctx, client.BuildCachePruneOptions{All: all})
	if err != nil {
		return 0, 0, err
	}
	return res.Report.SpaceReclaimed, len(res.Report.CachesDeleted), nil
}

// PruneAnonymousVolumes apaga os volumes anônimos que nenhum container usa (docker volume prune, sem
// -a: volumes com nome nunca entram).
func (c *Client) PruneAnonymousVolumes(ctx context.Context) (uint64, int, error) {
	res, err := c.cli.VolumePrune(ctx, client.VolumePruneOptions{})
	if err != nil {
		return 0, 0, err
	}
	return res.Report.SpaceReclaimed, len(res.Report.VolumesDeleted), nil
}

// PruneUnusedImages apaga as imagens que nenhum container usa (docker image prune -a).
func (c *Client) PruneUnusedImages(ctx context.Context) (uint64, int, error) {
	res, err := c.cli.ImagePrune(ctx, client.ImagePruneOptions{Filters: client.Filters{}.Add("dangling", "false")})
	if err != nil {
		return 0, 0, err
	}
	return res.Report.SpaceReclaimed, len(res.Report.ImagesDeleted), nil
}

// RemoveVolume apaga um volume pelo nome. Sem forçar: o Docker recusa se algum container o usa.
func (c *Client) RemoveVolume(ctx context.Context, name string) error {
	_, err := c.cli.VolumeRemove(ctx, name, client.VolumeRemoveOptions{})
	return err
}

// VolumeEvent é um evento de volume: criação ou montagem por um container.
type VolumeEvent struct {
	Action    string // create | mount
	Volume    string
	Container string // no mount
}

// WatchVolumes chama fn a cada criação ou montagem de volume, reconectando quando o daemon cai.
func (c *Client) WatchVolumes(ctx context.Context, fn func(VolumeEvent)) {
	backoff := time.Second
	for ctx.Err() == nil {
		err := c.watchVolumesOnce(ctx, fn)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			slog.Debug("eventos de volume", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}

func (c *Client) watchVolumesOnce(ctx context.Context, fn func(VolumeEvent)) error {
	res := c.cli.Events(ctx, client.EventsListOptions{Filters: client.Filters{}.Add("type", string(events.VolumeEventType))})
	for {
		select {
		case <-ctx.Done():
			return nil
		case m, ok := <-res.Messages:
			if !ok {
				return errors.New("canal de eventos fechado")
			}
			switch m.Action {
			case events.ActionCreate:
				fn(VolumeEvent{Action: "create", Volume: m.Actor.ID})
			case events.ActionMount:
				fn(VolumeEvent{Action: "mount", Volume: m.Actor.ID, Container: m.Actor.Attributes["container"]})
			}
		case err := <-res.Err:
			if err == nil {
				return errors.New("eventos encerrados")
			}
			return fmt.Errorf("eventos de volume: %w", err)
		}
	}
}

// ContainerOrigin devolve a imagem de um container e de onde ele veio: o projeto do compose (e a
// pasta), "testcontainers", ou vazio.
func (c *Client) ContainerOrigin(ctx context.Context, id string) (image, origin, dir string, err error) {
	res, err := c.cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		return "", "", "", err
	}
	ct := res.Container
	if ct.Config == nil {
		return "", "", "", errors.New("container sem configuração")
	}
	image = ct.Config.Image
	l := ct.Config.Labels
	switch {
	case l["com.docker.compose.project"] != "":
		origin, dir = l["com.docker.compose.project"], l["com.docker.compose.project.working_dir"]
	case l["org.testcontainers"] == "true":
		origin = "testcontainers"
	}
	return image, origin, dir, nil
}
