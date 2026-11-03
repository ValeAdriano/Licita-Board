"""Rodar: python3 -m unittest discover -s scripts/tests"""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "check_isolation_coverage.py"


class CoverageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "supabase/migrations").mkdir(parents=True)
        (self.root / "supabase/tests/isolamento").mkdir(parents=True)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def migration(self, name: str, sql: str) -> None:
        (self.root / "supabase/migrations" / name).write_text(sql)

    def isolation_test(self, table: str) -> None:
        (self.root / f"supabase/tests/isolamento/priv_{table}.test.sql").write_text("select 1;")

    def run_check(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.root)], capture_output=True, text=True, check=False
        )

    def test_sem_migrations_passa(self) -> None:
        self.assertEqual(self.run_check().returncode, 0)

    def test_tabela_sem_teste_falha(self) -> None:
        self.migration("1_a.sql", "create table priv.documentos (id uuid);\ncreate table core.empresas (id uuid);")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("priv.documentos", r.stderr)
        self.assertNotIn("empresas", r.stderr)

    def test_tabela_com_teste_passa(self) -> None:
        self.migration("1_a.sql", 'CREATE TABLE IF NOT EXISTS "priv"."documentos" (id uuid);')
        self.isolation_test("documentos")
        self.assertEqual(self.run_check().returncode, 0)

    def test_drop_e_rename_sao_seguidos(self) -> None:
        self.migration("1_a.sql", "create table priv.velha (id uuid); create table priv.temp (id uuid);")
        self.migration("2_b.sql", "alter table priv.velha rename to nova; drop table priv.temp;")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("priv.nova", r.stderr)
        self.assertNotIn("priv.temp", r.stderr)
        self.assertNotIn("priv.velha", r.stderr)

    def test_db_dbmate_conta_so_o_up(self) -> None:
        (self.root / "db/migrations").mkdir(parents=True)
        (self.root / "db/migrations/1_a.sql").write_text(
            "-- migrate:up\ncreate table priv.produtos (id uuid);\n-- migrate:down\ndrop table priv.produtos;\n"
        )
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("db/tests/isolamento/priv_produtos.test.sql", r.stderr)
        (self.root / "db/tests/isolamento").mkdir(parents=True)
        (self.root / "db/tests/isolamento/priv_produtos.test.sql").write_text("select 1;")
        self.assertEqual(self.run_check().returncode, 0)

    def test_comentario_nao_conta(self) -> None:
        self.migration("1_a.sql", "-- create table priv.fantasma (id uuid);\n/* create table priv.outra () */")
        self.assertEqual(self.run_check().returncode, 0)


if __name__ == "__main__":
    unittest.main()
