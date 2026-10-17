package claude

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"time"
)

// ErrNoHelper indica que o ajudante da máquina (helper/ajudante.py) não está rodando.
var ErrNoHelper = errors.New("o ajudante do Server Manager não está rodando nesta máquina: rode scripts/install.sh")

// HelperAvailable diz se o socket do ajudante existe.
func HelperAvailable(sock string) bool {
	st, err := os.Stat(sock)
	return err == nil && st.Mode()&os.ModeSocket != 0
}

// DeleteResult é a resposta do ajudante.
type DeleteResult struct {
	OK      bool     `json:"ok"`
	Stopped bool     `json:"encerrou"`
	Removed []string `json:"apagados"`
	Error   string   `json:"erro,omitempty"`
}

// Delete pede ao ajudante para encerrar a sessão (se aberta) e apagar a conversa.
func Delete(sock, sessionID string, pid int) (DeleteResult, error) {
	if !HelperAvailable(sock) {
		return DeleteResult{}, ErrNoHelper
	}
	conn, err := net.DialTimeout("unix", sock, 3*time.Second)
	if err != nil {
		return DeleteResult{}, fmt.Errorf("%w (%v)", ErrNoHelper, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(15 * time.Second))
	req, _ := json.Marshal(map[string]any{"acao": "apagar-sessao", "id": sessionID, "pid": pid})
	if _, err := conn.Write(append(req, '\n')); err != nil {
		return DeleteResult{}, err
	}
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return DeleteResult{}, fmt.Errorf("sem resposta do ajudante: %w", err)
	}
	var res DeleteResult
	if err := json.Unmarshal(line, &res); err != nil {
		return DeleteResult{}, err
	}
	if !res.OK {
		return res, errors.New(res.Error)
	}
	return res, nil
}
