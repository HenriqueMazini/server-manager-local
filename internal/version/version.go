// Package version guarda a versão do Server Manager, lida do arquivo VERSION na raiz.
package version

import "strings"

// Current é a versão em execução (ex.: "0.5.0"). É preenchida por main a partir do VERSION embutido.
var Current = "dev"

// Set normaliza e grava a versão.
func Set(raw string) {
	if v := strings.TrimSpace(raw); v != "" {
		Current = v
	}
}
