"""Testes do ajudante com uma home e um /proc falsos. Rodar: python3 -m unittest helper/test_ajudante.py"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ID = "11111111-2222-3333-4444-555555555555"
OTHER = "99999999-2222-3333-4444-555555555555"


def load(home, proc):
    os.environ["AJUDANTE_HOME"] = str(home)
    os.environ["AJUDANTE_PROC"] = str(proc)
    spec = importlib.util.spec_from_file_location("ajudante", Path(__file__).with_name("ajudante.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Ajudante(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.home = self.tmp / "home"
        c = self.home / ".claude"
        for d in ["projects/-home-u-loja/" + ID, "projects/-home-u-loja/" + OTHER, "file-history/" + ID, "session-env/" + ID, "sessions"]:
            (c / d).mkdir(parents=True)
        (c / "projects/-home-u-loja" / f"{ID}.jsonl").write_text("{}")
        (c / "projects/-home-u-loja" / f"{OTHER}.jsonl").write_text("{}")
        (c / "settings.json").write_text("{}")
        self.c = c

    def fake_claude(self):
        """O kernel nomeia o processo pelo arquivo executado: uma cópia do Python chamada claude.
        (O sleep do sistema pode ser multiuso e recusar rodar com outro nome.)"""
        exe = self.tmp / "claude"
        if not exe.exists():
            import shutil
            shutil.copy(sys.executable, exe)
        return exe

    def test_apaga_so_a_conversa_pedida(self):
        m = load(self.home, self.tmp / "proc-vazio")
        res = m.handle(json.dumps({"acao": "apagar-sessao", "id": ID}))
        self.assertTrue(res["ok"], res)
        self.assertFalse((self.c / "projects/-home-u-loja" / f"{ID}.jsonl").exists())
        self.assertFalse((self.c / "file-history" / ID).exists())
        self.assertFalse((self.c / "session-env" / ID).exists())
        self.assertTrue((self.c / "projects/-home-u-loja" / f"{OTHER}.jsonl").exists(), "outra conversa não pode ser tocada")
        self.assertTrue((self.c / "settings.json").exists())

    def test_recusa_id_invalido_e_coringas(self):
        m = load(self.home, self.tmp / "proc-vazio")
        for bad in ["", "*", "../..", "11111111-2222-3333-4444-55555555555*"]:
            res = m.handle(json.dumps({"acao": "apagar-sessao", "id": bad}))
            self.assertFalse(res["ok"], bad)
        self.assertTrue((self.c / "projects/-home-u-loja" / f"{ID}.jsonl").exists())

    def test_recusa_acao_desconhecida(self):
        m = load(self.home, self.tmp / "proc-vazio")
        self.assertFalse(m.handle(json.dumps({"acao": "apagar-tudo"}))["ok"])

    def test_recusa_link_para_fora(self):
        fora = self.tmp / "fora.txt"
        fora.write_text("não apagar")
        (self.c / "session-env" / ID).rmdir()
        (self.c / "session-env" / ID).symlink_to(fora)
        m = load(self.home, self.tmp / "proc-vazio")
        res = m.handle(json.dumps({"acao": "apagar-sessao", "id": ID}))
        self.assertFalse(res["ok"])
        self.assertTrue(fora.exists())

    def test_encerra_processo_real(self):
        # Um processo de verdade chamado "claude", com registro de sessão coerente.
        p = subprocess.Popen([str(self.fake_claude()), "-c", "import time; time.sleep(30)"])
        time.sleep(0.2)
        stat = Path(f"/proc/{p.pid}/stat").read_text()
        comm = stat[stat.index("(") + 1 : stat.rindex(")")]
        if comm != "claude":
            p.kill()
            self.skipTest(f"não deu para nomear o processo de teste como claude ({comm})")
        start = stat[stat.rindex(")") + 2 :].split()[19]
        (self.c / "sessions" / f"{p.pid}.json").write_text(json.dumps({"pid": p.pid, "sessionId": ID, "procStart": start}))
        m = load(self.home, Path("/proc"))
        res = m.handle(json.dumps({"acao": "apagar-sessao", "id": ID, "pid": p.pid}))
        p.wait(timeout=5)
        self.assertTrue(res["ok"], res)
        self.assertTrue(res["encerrou"])
        self.assertFalse((self.c / "sessions" / f"{p.pid}.json").exists())

    def test_recusa_processo_de_outra_conversa(self):
        p = subprocess.Popen([str(self.fake_claude()), "-c", "import time; time.sleep(30)"])
        time.sleep(0.2)
        try:
            stat = Path(f"/proc/{p.pid}/stat").read_text()
            if stat[stat.index("(") + 1 : stat.rindex(")")] != "claude":
                self.skipTest("processo de teste sem nome claude")
            (self.c / "sessions" / f"{p.pid}.json").write_text(json.dumps({"pid": p.pid, "sessionId": OTHER}))
            m = load(self.home, Path("/proc"))
            res = m.handle(json.dumps({"acao": "apagar-sessao", "id": ID, "pid": p.pid}))
            self.assertFalse(res["ok"])
            self.assertIsNone(p.poll(), "processo não pode ter sido encerrado")
            self.assertTrue((self.c / "projects/-home-u-loja" / f"{ID}.jsonl").exists())
        finally:
            p.kill()


class EncerrarServidor(unittest.TestCase):
    """Servidor de desenvolvimento esquecido: um processo com filho, rodando dentro de ~/projetos."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.projetos = self.tmp / "projetos"
        (self.projetos / "loja").mkdir(parents=True)
        os.environ["AJUDANTE_PROJETOS"] = str(self.projetos)
        self.m = load(self.tmp / "home", Path("/proc"))

    def tearDown(self):
        os.environ.pop("AJUDANTE_PROJETOS", None)

    def server(self, cwd):
        code = "import subprocess, time; subprocess.Popen(['sleep', '60']); time.sleep(60)"
        p = subprocess.Popen([sys.executable, "-c", code], cwd=cwd)
        time.sleep(0.3)
        self.addCleanup(lambda: (p.kill(), p.wait()))
        return p

    def start(self, pid):
        stat = Path(f"/proc/{pid}/stat").read_text()
        return stat[stat.rindex(")") + 2 :].split()[19]

    def test_encerra_o_processo_e_os_filhos(self):
        p = self.server(self.projetos / "loja")
        kids = self.m.descendants(p.pid)
        self.assertEqual(len(kids), 1)
        res = self.m.handle(json.dumps({"acao": "encerrar-processo", "pid": p.pid, "inicio": self.start(p.pid)}))
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["encerrados"], 2)
        p.wait(timeout=5)
        time.sleep(0.2)
        self.assertIsNone(self.m.proc_start(kids[0])[0], "o filho também precisa sair")

    def test_recusa_pid_reaproveitado(self):
        p = self.server(self.projetos / "loja")
        res = self.m.handle(json.dumps({"acao": "encerrar-processo", "pid": p.pid, "inicio": "1"}))
        self.assertFalse(res["ok"])
        self.assertIsNone(p.poll())

    def test_recusa_fora_de_projetos(self):
        p = self.server(self.tmp)
        res = self.m.handle(json.dumps({"acao": "encerrar-processo", "pid": p.pid, "inicio": self.start(p.pid)}))
        self.assertFalse(res["ok"])
        self.assertIn("projetos", res["erro"])
        self.assertIsNone(p.poll())

    def test_recusa_pedido_incompleto(self):
        for req in [{"pid": 1, "inicio": "1"}, {"pid": "x", "inicio": "1"}, {"pid": os.getpid()}]:
            res = self.m.handle(json.dumps({"acao": "encerrar-processo", **req}))
            self.assertFalse(res["ok"], req)


if __name__ == "__main__":
    unittest.main()
