#!/usr/bin/env python3
"""Ajudante do Server Manager: roda fora do Docker, com o usuário da máquina.

O painel roda num container que só lê a home e os processos. Para apagar uma sessão do
Claude Code ele pede a este ajudante, por um socket Unix, que faz uma única coisa:

  encerrar a sessão (se estiver aberta) e apagar os arquivos dela em ~/.claude.

Conferências antes de agir:
  - o ID da conversa tem formato de UUID;
  - se vier um pid, o processo é um `claude` e ~/.claude/sessions/<pid>.json aponta para
    a mesma conversa, com o mesmo horário de início (PID reaproveitado não passa);
  - todo caminho apagado fica dentro de ~/.claude.

Protocolo: uma linha JSON por pedido, uma linha JSON de resposta.
  {"acao": "apagar-sessao", "id": "<uuid>", "pid": 1234}
  {"ok": true, "encerrou": true, "apagados": ["projects/.../<id>.jsonl", ...]}
"""
import json
import os
import re
import shutil
import signal
import socket
import sys
import time
from pathlib import Path

HOME = Path(os.environ.get("AJUDANTE_HOME", str(Path.home())))
CLAUDE = HOME / ".claude"
PROC = Path(os.environ.get("AJUDANTE_PROC", "/proc"))
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
LOG = HOME / ".local" / "state" / "server-manager" / "ajudante.log"


def log(msg):
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
    except OSError:
        pass


class Recusado(Exception):
    """Pedido recusado por uma das conferências."""


def inside_claude(p: Path) -> Path:
    real = p.resolve()
    root = CLAUDE.resolve()
    if real != root and root not in real.parents:
        raise Recusado(f"caminho fora de ~/.claude: {p}")
    if real == root:
        raise Recusado("recusado: apagaria ~/.claude inteiro")
    return real


def proc_start(pid: int):
    try:
        stat = (PROC / str(pid) / "stat").read_text()
        comm = stat[stat.index("(") + 1 : stat.rindex(")")]
        return comm, stat[stat.rindex(")") + 2 :].split()[19]
    except (OSError, ValueError, IndexError):
        return None, None


def stop_session(pid: int, session_id: str) -> bool:
    """Encerra o processo do Claude dono da conversa. Devolve True se havia processo."""
    comm, start = proc_start(pid)
    if comm is None:
        return False  # já encerrada
    if comm != "claude":
        raise Recusado(f"o processo {pid} não é uma sessão do Claude ({comm})")
    try:
        meta = json.loads((CLAUDE / "sessions" / f"{pid}.json").read_text())
    except (OSError, ValueError):
        raise Recusado(f"sem registro da sessão para o processo {pid}")
    if meta.get("sessionId") != session_id:
        raise Recusado("o processo informado é de outra conversa")
    if meta.get("procStart") and meta["procStart"] != start:
        raise Recusado("o processo informado reaproveitou o pid de outra sessão")
    os.kill(pid, signal.SIGTERM)
    for _ in range(50):  # até 5 s para o Claude fechar sozinho
        if proc_start(pid)[0] is None:
            return True
        time.sleep(0.1)
    os.kill(pid, signal.SIGKILL)
    time.sleep(0.2)
    return True


def delete_session(session_id: str, pid=None) -> dict:
    if not UUID.match(session_id or ""):
        raise Recusado("ID de conversa inválido")
    stopped = stop_session(int(pid), session_id) if pid else False
    targets = []
    targets += list((CLAUDE / "projects").glob(f"*/{session_id}.jsonl"))
    targets += [d for d in (CLAUDE / "projects").glob(f"*/{session_id}") if d.is_dir()]
    for sub in ("file-history", "session-env", "todos"):
        targets += list((CLAUDE / sub).glob(f"{session_id}*"))
    if pid:
        targets.append(CLAUDE / "sessions" / f"{int(pid)}.json")
    removed = []
    for t in targets:
        if not t.exists() and not t.is_symlink():
            continue
        real = inside_claude(t)
        if real.is_dir() and not t.is_symlink():
            shutil.rmtree(real)
        else:
            t.unlink()
        removed.append(str(t.relative_to(CLAUDE)))
    if not removed and not stopped:
        raise Recusado("nenhum arquivo dessa conversa encontrado")
    return {"ok": True, "encerrou": stopped, "apagados": removed}


def handle(line: str) -> dict:
    try:
        req = json.loads(line)
        if req.get("acao") != "apagar-sessao":
            raise Recusado("ação desconhecida")
        res = delete_session(req.get("id", ""), req.get("pid"))
        log(f"apagada {req.get('id')} (pid {req.get('pid')}): {len(res['apagados'])} itens")
        return res
    except Recusado as e:
        log(f"recusado: {e}")
        return {"ok": False, "erro": str(e)}
    except Exception as e:  # noqa: BLE001 - o painel precisa de uma resposta, não de uma conexão caída
        log(f"falha: {e!r}")
        return {"ok": False, "erro": f"falha inesperada: {e}"}


def serve(sock_path: str):
    path = Path(sock_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        path.unlink()
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    old = os.umask(0o177)  # socket só para o dono
    srv.bind(str(path))
    os.umask(old)
    srv.listen(4)
    log(f"ouvindo em {path}")
    while True:
        conn, _ = srv.accept()
        with conn:
            conn.settimeout(10)
            buf = b""
            try:
                while not buf.endswith(b"\n") and len(buf) < 4096:
                    chunk = conn.recv(1024)
                    if not chunk:
                        break
                    buf += chunk
            except socket.timeout:
                continue
            res = handle(buf.decode("utf-8", "replace").strip())
            try:
                conn.sendall((json.dumps(res, ensure_ascii=False) + "\n").encode())
            except OSError:
                pass


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("uso: ajudante.py <caminho-do-socket>", file=sys.stderr)
        sys.exit(2)
    serve(sys.argv[1])
