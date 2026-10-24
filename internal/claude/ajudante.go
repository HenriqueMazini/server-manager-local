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
	var res DeleteResult
	err := call(sock, map[string]any{"acao": "apagar-sessao", "id": sessionID, "pid": pid}, &res)
	if err == nil && !res.OK {
		err = errors.New(res.Error)
	}
	return res, err
}

// StopResult é a resposta do ajudante ao encerrar um servidor de desenvolvimento.
type StopResult struct {
	OK      bool   `json:"ok"`
	Stopped int    `json:"encerrados"`
	Error   string `json:"erro,omitempty"`
}

// StopProcess pede ao ajudante para encerrar um servidor de desenvolvimento rodando fora do Docker
// (o processo e todos os filhos). start é o início do processo, para não acertar um pid reaproveitado.
func StopProcess(sock string, pid int, start string) (StopResult, error) {
	var res StopResult
	err := call(sock, map[string]any{"acao": "encerrar-processo", "pid": pid, "inicio": start}, &res)
	if err == nil && !res.OK {
		err = errors.New(res.Error)
	}
	return res, err
}

// call manda um pedido ao ajudante e lê a resposta, uma linha JSON cada.
func call(sock string, req, out any) error {
	if !HelperAvailable(sock) {
		return ErrNoHelper
	}
	conn, err := net.DialTimeout("unix", sock, 3*time.Second)
	if err != nil {
		return fmt.Errorf("%w (%v)", ErrNoHelper, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(15 * time.Second))
	b, _ := json.Marshal(req)
	if _, err := conn.Write(append(b, '\n')); err != nil {
		return err
	}
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return fmt.Errorf("sem resposta do ajudante: %w", err)
	}
	return json.Unmarshal(line, out)
}
