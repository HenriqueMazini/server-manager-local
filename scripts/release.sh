#!/usr/bin/env bash
# Lança uma nova versão do Server Manager.
#
#   scripts/release.sh patch|minor|major|X.Y.Z
#
# 1. Calcula a próxima versão a partir do arquivo VERSION.
# 2. Move as notas de "Não lançado" do CHANGELOG.md para a nova versão.
# 3. Grava VERSION, faz o commit "Versão X.Y.Z" e cria a tag vX.Y.Z.
# Não envia nada: o push fica para você (o comando aparece no fim).
set -euo pipefail

cd "$(dirname "$0")/.."
REPO=https://github.com/HenriqueMazini/server-manager-local

die() { echo "erro: $*" >&2; exit 1; }

[[ $# -eq 1 ]] || die "uso: scripts/release.sh patch|minor|major|X.Y.Z"
[[ -z "$(git status --porcelain)" ]] || die "há alterações sem commit. Faça o commit delas antes de lançar."

current=$(tr -d '[:space:]' < VERSION)
[[ $current =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "VERSION inválido: '$current'"
major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]}

case "$1" in
  patch) next="$major.$minor.$((patch + 1))" ;;
  minor) next="$major.$((minor + 1)).0" ;;
  major) next="$((major + 1)).0.0" ;;
  *)
    [[ $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "versão inválida: '$1'"
    next=$1
    ;;
esac

git rev-parse -q --verify "refs/tags/v$next" >/dev/null && die "a tag v$next já existe"

today=$(date +%F)
python3 - "$current" "$next" "$today" "$REPO" <<'PY'
import re, sys
current, nxt, today, repo = sys.argv[1:]
path = "CHANGELOG.md"
s = open(path, encoding="utf-8").read()
m = re.search(r"## \[Não lançado\]\n(.*?)(?=\n## \[)", s, re.S)
if not m:
    sys.exit("erro: seção '## [Não lançado]' não encontrada no CHANGELOG.md")
notes = m.group(1).strip()
if not notes:
    sys.exit("erro: a seção 'Não lançado' está vazia. Anote as mudanças antes de lançar.")
s = s.replace(m.group(0), f"## [Não lançado]\n\n## [{nxt}] - {today}\n\n{notes}\n", 1)
s = re.sub(r"^\[Não lançado\]: .*$",
           f"[Não lançado]: {repo}/compare/v{nxt}...HEAD\n[{nxt}]: {repo}/compare/v{current}...v{nxt}",
           s, count=1, flags=re.M)
open(path, "w", encoding="utf-8").write(s)
PY

echo "$next" > VERSION
git add VERSION CHANGELOG.md
git commit -q -m "Versão $next"
git tag -a "v$next" -m "Versão $next"

echo "Versão $next pronta: commit e tag v$next criados."
echo "Para publicar:  git push origin main --follow-tags"
echo "Para atualizar o painel:  docker compose up -d --build"
