package diskx

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/moby/moby/api/types/build"
	"github.com/moby/moby/api/types/image"
	"github.com/moby/moby/api/types/volume"
	"github.com/moby/moby/client"
)

const hex64 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestClassify(t *testing.T) {
	gb := int64(1 << 30)
	du := client.DiskUsageResult{
		BuildCache: client.BuildCacheDiskUsage{Items: []build.CacheRecord{
			{ID: "a", Size: 10 * gb},
			{ID: "b", Size: 2 * gb, InUse: true},
			{ID: "c", Size: 1 * gb, Shared: true},
		}},
		Images: client.ImagesDiskUsage{TotalCount: 3, Items: []image.Summary{
			{ID: "sha256:usada", Containers: 1, Size: 100},
			{ID: "sha256:loja", Containers: 0, Size: 500, SharedSize: 100, RepoTags: []string{"loja:local"}},
			{ID: "sha256:pg", Containers: 0, Size: 300, RepoTags: []string{"postgres:16"}, RepoDigests: []string{"postgres@sha256:x"}},
		}},
		Volumes: client.VolumesDiskUsage{Items: []volume.Volume{
			{Name: hex64, UsageData: &volume.UsageData{RefCount: 0, Size: 40}},
			{Name: strings.Replace(hex64, "0", "f", 1), UsageData: &volume.UsageData{RefCount: 1, Size: 99}},
			{Name: "loja-feature_pgdata", Labels: map[string]string{"com.docker.compose.project": "loja-feature"}, UsageData: &volume.UsageData{RefCount: 0, Size: 70}, CreatedAt: "2026-10-01T10:00:00-03:00"},
			{Name: "antigo_cache", UsageData: &volume.UsageData{RefCount: 0, Size: 5}},
			{Name: "loja_pgdata", UsageData: &volume.UsageData{RefCount: 2, Size: 500}},
		}},
	}
	d := Classify(du, time.Now())
	if d.Build.Total != uint64(13*gb) || d.Build.Reclaimable != uint64(10*gb) || d.Build.Active != 1 {
		t.Errorf("build = %+v", d.Build)
	}
	if len(d.UnusedImages) != 2 || d.UnusedImages[0].Tags[0] != "loja:local" || !d.UnusedImages[0].Local || d.UnusedImages[0].Size != 400 || d.UnusedImages[1].Local {
		t.Errorf("imagens = %+v", d.UnusedImages)
	}
	if d.Images.Reclaimable != 700 {
		t.Errorf("imagens liberáveis = %d", d.Images.Reclaimable)
	}
	if d.AnonUnused.Count != 1 || d.AnonUnused.Total != 40 || len(d.AnonSample) != 1 {
		t.Errorf("anônimos = %+v", d.AnonUnused)
	}
	if len(d.NamedUnused) != 2 || d.NamedUnused[0].Project != "antigo" || d.NamedUnused[1].Project != "loja-feature" || d.NamedUnused[1].CreatedAt.IsZero() {
		t.Errorf("com nome = %+v", d.NamedUnused)
	}
}

func TestHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "volumes.json")
	h := NewHistory(path)
	now := time.Date(2026, 10, 29, 15, 0, 0, 0, time.Local) // quinta-feira
	h.now = func() time.Time { return now }
	h.Created("loja_pgdata") // com nome: não conta
	h.Created(hex64)
	h.Created(strings.Replace(hex64, "0", "f", 1))
	h.Mounted(hex64, "postgres:16", "testcontainers", "")
	h.Mounted(hex64, "postgres:16", "testcontainers", "") // já atribuído: ignora
	h.Mounted("outro", "redis", "", "")                   // não estava pendente

	got := NewHistory(path).Snapshot() // relido do disco
	if len(got.Weeks) != 1 || got.Weeks[0].Week != "2026-10-26" || got.Weeks[0].Count != 2 {
		t.Errorf("semanas = %+v", got.Weeks)
	}
	if len(got.Sources) != 1 || got.Sources[0].Image != "postgres:16" || got.Sources[0].Origin != "testcontainers" || got.Sources[0].Count != 1 {
		t.Errorf("origens = %+v", got.Sources)
	}
}

func TestFilesystems(t *testing.T) {
	fs := Filesystems(t.TempDir(), t.TempDir(), "/caminho/que/nao/existe")
	if len(fs) != 1 || fs[0].Total == 0 || fs[0].Used > fs[0].Total {
		t.Errorf("fs = %+v", fs)
	}
}
