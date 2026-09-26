#!/usr/bin/env bash
# Instala e sobe o Server Manager nesta máquina.
#
#   scripts/install.sh
#
# 1. Confere Linux, Docker e Docker Compose.
# 2. Grava no .env o seu UID/GID e o GID do grupo docker.
# 3. Constrói a imagem, sobe o painel e espera ele responder em http://localhost:9090.
# Pode rodar de novo a qualquer momento: também serve para atualizar.
set -euo pipefail

cd "$(dirname "$0")/.."

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31merro:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || die "o Server Manager só roda em Linux (usa a rede e o /proc do host)."
command -v docker >/dev/null || die "Docker não encontrado. Instale: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 não encontrado (comando 'docker compose')."
docker info >/dev/null 2>&1 || die "sem acesso ao Docker. Adicione seu usuário ao grupo docker (sudo usermod -aG docker \$USER) e abra uma nova sessão."

docker_gid=$(stat -c '%g' /var/run/docker.sock)
say "Configuração detectada"
echo "  usuário: $(id -un) (UID $(id -u), GID $(id -g))"
echo "  grupo do socket do Docker: GID $docker_gid"
cat > .env <<ENV
# Gerado por scripts/install.sh. Rode o script de novo se trocar de usuário ou de máquina.
HOST_UID=$(id -u)
HOST_GID=$(id -g)
DOCKER_GID=$docker_gid
ENV

if [[ ! -d "$HOME/projetos" ]]; then
  echo "  aviso: ~/projetos não existe. O painel funciona, mas a lista do \"Criar server\" fica vazia."
fi

say "Construindo e subindo o painel"
docker compose up -d --build

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:9090/healthz >/dev/null 2>&1; then
    say "Pronto: http://localhost:9090"
    exit 0
  fi
  sleep 1
done
die "o painel não respondeu. Veja os logs com: docker compose logs server-manager"
