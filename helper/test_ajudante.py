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


if __name__ == "__main__":
    unittest.main()
