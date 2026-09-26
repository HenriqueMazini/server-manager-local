package projects

import (
	"fmt"
	"strings"
)

// imageBase reduz "docker.io/library/postgres:16-alpine" a "postgres".
func imageBase(image string) string {
	s := image
	if i := strings.Index(s, "@"); i >= 0 {
		s = s[:i]
	}
	if i := strings.LastIndex(s, "/"); i >= 0 {
		s = s[i+1:]
	}
	if i := strings.Index(s, ":"); i >= 0 {
		s = s[:i]
	}
	return strings.ToLower(s)
}

// URLFor monta a URL de acesso a partir da imagem e das portas.
func URLFor(image string, hostIP string, hostPort, containerPort uint16, proto string) string {
	if proto != "tcp" {
		return ""
	}
	host := "localhost"
	if hostIP != "" && hostIP != "0.0.0.0" && hostIP != "::" && hostIP != "127.0.0.1" && hostIP != "::1" {
		host = hostIP
		if strings.Contains(host, ":") {
			host = "[" + host + "]"
		}
	}
	addr := fmt.Sprintf("%s:%d", host, hostPort)
	base := imageBase(image)
	switch {
	case strings.Contains(base, "postgres") || strings.Contains(base, "postgis") || containerPort == 5432:
		return "postgres://" + addr
	case strings.Contains(base, "redis") || strings.Contains(base, "valkey") || strings.Contains(base, "keydb") || containerPort == 6379:
		return "redis://" + addr
	case strings.Contains(base, "mysql") || strings.Contains(base, "mariadb") || containerPort == 3306:
		return "mysql://" + addr
	case strings.Contains(base, "mongo") || containerPort == 27017:
		return "mongodb://" + addr
	case containerPort == 5672:
		return "amqp://" + addr
	case containerPort == 1433:
		return "sqlserver://" + addr
	case containerPort == 443 || containerPort == 8443:
		return "https://" + addr
	default:
		return "http://" + addr
	}
}

// IsWebURL diz se a URL abre no navegador.
func IsWebURL(u string) bool {
	return strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://")
}
