// Package labels guarda os apelidos dos projetos, digitados no painel.
//
// O apelido aparece entre parênteses depois do nome, por exemplo "Loja (Vendas)". Serve para
// projetos cujo nome mudou mas o repositório, as pastas e os containers ainda usam o antigo.
// Fica num arquivo próprio do painel: o services.yml continua sendo só do usuário.
package labels

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode"
)

// MaxLen é o tamanho máximo de um apelido, em caracteres.
const MaxLen = 60

// ErrTooLong é devolvido quando o apelido passa de MaxLen.
var ErrTooLong = fmt.Errorf("o apelido pode ter até %d caracteres", MaxLen)

// Store lê e grava os apelidos num arquivo JSON.
type Store struct {
	path string
	mu   sync.Mutex
}

// New cria o Store para o arquivo informado. A pasta precisa existir e ser gravável.
func New(path string) *Store { return &Store{path: path} }

// All devolve todos os apelidos, por chave de projeto. Arquivo ausente vale como vazio.
func (s *Store) All() map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read()
}

func (s *Store) read() map[string]string {
	out := map[string]string{}
	b, err := os.ReadFile(s.path)
	if err != nil {
		return out
	}
	_ = json.Unmarshal(b, &out)
	return out
}

// Clean tira espaços das pontas e caracteres de controle.
func Clean(alias string) string {
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, alias))
}

// Set grava o apelido de um projeto. Apelido vazio remove.
func (s *Store) Set(key, alias string) (string, error) {
	alias = Clean(alias)
	if len([]rune(alias)) > MaxLen {
		return "", ErrTooLong
	}
	if key == "" {
		return "", errors.New("projeto sem chave")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	all := s.read()
	if alias == "" {
		delete(all, key)
	} else {
		all[key] = alias
	}
	b, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".apelidos-*.json")
	if err != nil {
		return "", fmt.Errorf("a pasta de dados do painel não é gravável (%w); rode scripts/install.sh", err)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(append(b, '\n')); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmp.Name(), s.path); err != nil {
		return "", err
	}
	return alias, nil
}
