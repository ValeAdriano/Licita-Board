"""Testes do hook guard.py. Rodar: python3 -m unittest discover -s .claude/hooks/tests"""

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

GUARD = Path(__file__).resolve().parents[1] / "guard.py"
ROOT = GUARD.parents[2]


def run(tool: str, tool_input: dict[str, object]) -> subprocess.CompletedProcess[str]:
    payload = json.dumps({"tool_name": tool, "tool_input": tool_input})
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(ROOT)}
    return subprocess.run(
        [sys.executable, str(GUARD)], input=payload, capture_output=True, text=True, env=env, check=False
    )


def path(rel: str) -> str:
    return str(ROOT / rel)


class GuardTest(unittest.TestCase):
    def assertBlocked(self, r: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("BLOQUEADO", r.stderr)

    def assertAsks(self, r: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(r.returncode, 0)
        self.assertEqual(json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"], "ask")

    def assertAllowed(self, r: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "")

    def test_service_role_no_front(self) -> None:
        self.assertBlocked(run("Write", {"file_path": path("apps/web/src/x.ts"), "content": "const k = SUPABASE_SERVICE_ROLE_KEY"}))
        self.assertBlocked(run("Edit", {"file_path": path("apps/web/src/x.ts"), "old_string": "a", "new_string": "sb_secret_abc"}))

    def test_service_role_no_worker_permitido(self) -> None:
        self.assertAllowed(run("Write", {"file_path": path("apps/worker/src/worker/settings.py"), "content": "supabase_service_role_key"}))

    def test_env_real_bloqueado_example_liberado(self) -> None:
        self.assertBlocked(run("Write", {"file_path": path("apps/web/.env.local"), "content": "X=1"}))
        self.assertBlocked(run("Write", {"file_path": path(".env"), "content": "X=1"}))
        self.assertAllowed(run("Write", {"file_path": path("apps/web/.env.example"), "content": "X="}))

    def test_float_em_rules(self) -> None:
        self.assertBlocked(run("Write", {"file_path": path("apps/worker/src/worker/rules/precos.py"), "content": "def f(x: float) -> float: ..."}))
        self.assertAllowed(run("Write", {"file_path": path("apps/worker/src/worker/rules/precos.py"), "content": "from decimal import Decimal"}))

    def test_rls_off_em_migration(self) -> None:
        mig = path("supabase/migrations/29990101000000_x.sql")
        self.assertBlocked(run("Write", {"file_path": mig, "content": "alter table priv.x disable row level security;"}))
        self.assertBlocked(run("Write", {"file_path": mig, "content": "create policy p on priv.x using ( true );"}))
        self.assertAllowed(run("Write", {"file_path": mig, "content": "alter table priv.x enable row level security;"}))

    def test_bash_destrutivo_pede_confirmacao(self) -> None:
        for cmd in [
            "git push --force origin main",
            "git push -f",
            "npx supabase db reset --linked",
            "npx supabase db push",
            "npx supabase test db --linked",
            "psql -c 'drop schema priv cascade'",
            "rm -rf /",
            "rm -rf .",
            "railway up",
            "vercel deploy --prod",
            "git reset --hard HEAD~1",
        ]:
            with self.subTest(cmd=cmd):
                self.assertAsks(run("Bash", {"command": cmd}))

    def test_bash_comum_liberado(self) -> None:
        for cmd in ["npx supabase db reset", "npx supabase test db", "rm -rf ./node_modules", "git push origin feat/x", "railway logs", "uv run pytest"]:
            with self.subTest(cmd=cmd):
                self.assertAllowed(run("Bash", {"command": cmd}))


if __name__ == "__main__":
    unittest.main()
