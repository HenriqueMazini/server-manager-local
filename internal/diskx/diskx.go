// Package diskx mostra o uso do disco e o que o Docker ocupa nele: cache de build, imagens, volumes e
// containers, com o que está sem uso e dá para liberar.
package diskx

import (
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/moby/moby/api/types/build"
	"github.com/moby/moby/api/types/image"
	"github.com/moby/moby/api/types/volume"
	"github.com/moby/moby/client"

	"servermanager/internal/model"
)

// Filesystems lê o uso de cada caminho (statfs, sem tocar em /proc). Caminhos no mesmo disco aparecem
// uma vez só: o primeiro da lista dá o nome. O mesmo disco é reconhecido pelo tamanho total, porque a
// raiz de um container (overlay) tem outro identificador que o disco por baixo dela.
func Filesystems(paths ...string) []model.DiskFS {
	out := []model.DiskFS{}
	seen := map[uint64]bool{}
	for _, p := range paths {
		if p == "" {
			continue
		}
		var st syscall.Statfs_t
		if err := syscall.Statfs(p, &st); err != nil || st.Blocks == 0 {
			continue
		}
		bs := uint64(st.Bsize)
		total := st.Blocks * bs
		if seen[total] {
			continue
		}
		seen[total] = true
		free := st.Bavail * bs
		out = append(out, model.DiskFS{Path: p, Total: total, Used: total - st.Bfree*bs, Free: free})
	}
	return out
}

var anonName = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Anonymous diz se o volume é anônimo: o Docker dá um nome de 64 caracteres hexadecimais a quem não
// pediu nome (VOLUME no Dockerfile, -v /caminho, bancos de teste).
func Anonymous(name string) bool { return anonName.MatchString(name) }

// AnonSample é quantos volumes anônimos o relatório traz para mostrar antes de apagar.
const AnonSample = 20

// Classify monta o relatório a partir do docker system df detalhado.
func Classify(du client.DiskUsageResult, at time.Time) model.DockerDisk {
	d := model.DockerDisk{At: at, AnonSample: []model.DiskVolume{}, NamedUnused: []model.DiskVolume{}, UnusedImages: []model.DiskImage{}}
	d.Build = category(du.BuildCache.TotalCount, du.BuildCache.ActiveCount, du.BuildCache.TotalSize, du.BuildCache.Reclaimable)
	d.Images = category(du.Images.TotalCount, du.Images.ActiveCount, du.Images.TotalSize, du.Images.Reclaimable)
	d.Containers = category(du.Containers.TotalCount, du.Containers.ActiveCount, du.Containers.TotalSize, du.Containers.Reclaimable)
	d.Volumes = category(du.Volumes.TotalCount, du.Volumes.ActiveCount, du.Volumes.TotalSize, du.Volumes.Reclaimable)

	if len(du.BuildCache.Items) > 0 {
		d.Build = buildCategory(du.BuildCache.Items)
	}
	for _, img := range du.Images.Items {
		if img.Containers != 0 {
			continue
		}
		d.UnusedImages = append(d.UnusedImages, unusedImage(img))
	}
	sort.Slice(d.UnusedImages, func(i, j int) bool { return d.UnusedImages[i].Size > d.UnusedImages[j].Size })
	if d.Images.Reclaimable == 0 {
		for _, img := range d.UnusedImages {
			d.Images.Reclaimable += img.Size
		}
	}

	var anon []model.DiskVolume
	for _, v := range du.Volumes.Items {
		if v.UsageData == nil || v.UsageData.RefCount != 0 {
			continue
		}
		dv := diskVolume(v)
		if Anonymous(v.Name) {
			anon = append(anon, dv)
			d.AnonUnused.Count++
			d.AnonUnused.Total += dv.Size
		} else {
			d.NamedUnused = append(d.NamedUnused, dv)
		}
	}
	d.AnonUnused.Reclaimable = d.AnonUnused.Total
	sort.Slice(anon, func(i, j int) bool { return anon[i].Size > anon[j].Size })
	if len(anon) > AnonSample {
		anon = anon[:AnonSample]
	}
	d.AnonSample = append(d.AnonSample, anon...)
	// Por projeto e, dentro dele, do maior para o menor.
	sort.Slice(d.NamedUnused, func(i, j int) bool {
		a, b := d.NamedUnused[i], d.NamedUnused[j]
		if a.Project != b.Project {
			return a.Project < b.Project
		}
		return a.Size > b.Size
	})
	return d
}

func category(count, active, total, reclaimable int64) model.DiskCategory {
	return model.DiskCategory{Count: int(count), Active: int(active), Total: pos(total), Reclaimable: pos(reclaimable)}
}

// buildCategory soma o cache de build pelos registros: o daemon nem sempre manda os totais.
func buildCategory(items []build.CacheRecord) model.DiskCategory {
	c := model.DiskCategory{Count: len(items)}
	for _, r := range items {
		c.Total += pos(r.Size)
		if r.InUse {
			c.Active++
		} else if !r.Shared {
			c.Reclaimable += pos(r.Size)
		}
	}
	return c
}

func unusedImage(img image.Summary) model.DiskImage {
	tags := []string{}
	for _, t := range img.RepoTags {
		if t != "<none>:<none>" {
			tags = append(tags, t)
		}
	}
	size := pos(img.Size)
	if img.SharedSize > 0 && img.SharedSize < img.Size {
		size = pos(img.Size - img.SharedSize) // camadas compartilhadas continuam com quem usa
	}
	return model.DiskImage{
		ID:      strings.TrimPrefix(img.ID, "sha256:"),
		Tags:    tags,
		Size:    size,
		Created: time.Unix(img.Created, 0),
		// Sem digest de registro: foi construída nesta máquina e não dá para baixar de novo.
		Local: len(img.RepoDigests) == 0,
	}
}

func diskVolume(v volume.Volume) model.DiskVolume {
	dv := model.DiskVolume{Name: v.Name, Project: v.Labels["com.docker.compose.project"]}
	if v.UsageData != nil {
		dv.Size = pos(v.UsageData.Size)
	}
	if t, err := time.Parse(time.RFC3339, v.CreatedAt); err == nil {
		dv.CreatedAt = t
	}
	if dv.Project == "" && !Anonymous(v.Name) {
		// Sem label do compose: o prefixo antes do primeiro "_" costuma ser o projeto.
		if i := strings.IndexByte(v.Name, '_'); i > 0 {
			dv.Project = v.Name[:i]
		}
	}
	return dv
}

func pos(n int64) uint64 {
	if n < 0 {
		return 0
	}
	return uint64(n)
}
