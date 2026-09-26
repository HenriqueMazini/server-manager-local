// Package config carrega o services.yml opcional e o recarrega quando o arquivo muda.
package config

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// Config é o conteúdo do services.yml.
type Config struct {
	Projects map[string]ProjectCfg `yaml:"projects"`
	Hide     []string              `yaml:"hide"`
	Ports    PortsCfg              `yaml:"ports"`
}

// ProjectCfg junta infraestrutura (containers) e apps de desenvolvimento em um projeto.
type ProjectCfg struct {
	Name       string   `yaml:"name"`
	Dir        string   `yaml:"dir"`
	Compose    []string `yaml:"compose"`    // projetos compose que fazem parte
	Containers []string `yaml:"containers"` // containers avulsos que fazem parte
	Apps       []AppCfg `yaml:"apps"`
}

// AppCfg é um processo de desenvolvimento (npm run dev, por exemplo) que o painel roda num container Node.
type AppCfg struct {
	Key     string            `yaml:"key"`
	Name    string            `yaml:"name"`
	Dir     string            `yaml:"dir"` // relativo ao dir do projeto, ou absoluto
	Command string            `yaml:"command"`
	Port    uint16            `yaml:"port"`
	URL     string            `yaml:"url"`
	Image   string            `yaml:"image"`
	Env     map[string]string `yaml:"env"`
}

// PortsCfg configura a gestão de portas.
type PortsCfg struct {
	Reserved []uint16 `yaml:"reserved"`
}

// Parse interpreta o YAML.
func Parse(b []byte) (Config, error) {
	var c Config
	if err := yaml.Unmarshal(b, &c); err != nil {
		return Config{}, err
	}
	return c, nil
}

// HostHome é a home do usuário na máquina, usada para expandir "~" nos caminhos.
// No container vem de SM_HOST_HOME; fora do Docker, é a home de quem roda o painel.
var HostHome = hostHome()

func hostHome() string {
	if v := os.Getenv("SM_HOST_HOME"); v != "" {
		return v
	}
	h, _ := os.UserHomeDir()
	return h
}

// ExpandPath resolve "~" e caminhos relativos a base.
func ExpandPath(p, base string) string {
	if p == "" {
		return base
	}
	if p == "~" || strings.HasPrefix(p, "~/") {
		p = filepath.Join(HostHome, strings.TrimPrefix(p, "~"))
	}
	if !filepath.IsAbs(p) && base != "" {
		p = filepath.Join(base, p)
	}
	return filepath.Clean(p)
}

// Loader relê o arquivo só quando o mtime muda. Arquivo ausente vale como config vazia.
type Loader struct {
	path  string
	mu    sync.Mutex
	mtime time.Time
	cur   Config
	err   error
}

// NewLoader cria um Loader para o caminho informado.
func NewLoader(path string) *Loader { return &Loader{path: path} }

// Get devolve a config atual e o último erro de leitura, se houver.
func (l *Loader) Get() (Config, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.path == "" {
		return Config{}, nil
	}
	st, err := os.Stat(l.path)
	if errors.Is(err, fs.ErrNotExist) {
		l.cur, l.err, l.mtime = Config{}, nil, time.Time{}
		return l.cur, nil
	}
	if err != nil {
		return l.cur, err
	}
	if st.ModTime().Equal(l.mtime) {
		return l.cur, l.err
	}
	l.mtime = st.ModTime()
	b, err := os.ReadFile(l.path)
	if err != nil {
		l.err = err
		return l.cur, err
	}
	c, err := Parse(b)
	if err != nil {
		l.err = err
		return l.cur, err
	}
	l.cur, l.err = c, nil
	return c, nil
}
