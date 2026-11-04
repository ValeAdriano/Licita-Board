#!/usr/bin/env python3
"""Hook PreToolUse do Claude Code: barra as violações mais caras das regras do AGENTS.md.

Entrada: JSON do Claude Code no stdin. Saída:
- exit 0 sem nada: libera;
- exit 2 + mensagem no stderr: bloqueia (a mensagem volta para o agente);
- JSON com permissionDecision "ask": pede confirmação humana.

Sem dependências externas: roda com o python3 do sistema.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import PurePosixPath

PROJECT_DIR = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())

# Front (bundle público): nenhuma credencial de banco, S3 ou chave-mestra (AGENTS.md §3.11, ADR-017).
SECRET_IN_APP = re.compile(
    r"service[_-]?role|sb_secret_|vv_(worker|owner|api)\b|VV_\w*PASSWORD|POSTGRES_PASSWORD|DATABASE_URL"
    r"|S3_SECRET|SECRET_ACCESS_KEY|CHAVE_MESTRA|(?<![A-Za-z])KEK(?![A-Za-z])|TURNSTILE_SECRET|JWT_SECRET"
    r"|VAPID_PRIVATE|SMTP_PASS\w*|VITE_\w*(?:SECRET|PASSWORD|PRIVATE|TOKEN)",
    re.IGNORECASE,
)
# API: só usa vv_api (ADR-013); credenciais do worker/owner nunca entram.
SECRET_IN_API = re.compile(r"vv_(worker|owner)\b|VV_(WORKER|OWNER)_PASSWORD|POSTGRES_PASSWORD", re.IGNORECASE)
MIGRATION_DIRS = ("db/migrations/",)
FLOAT_MONEY = re.compile(r"\bfloat\s*\(|:\s*float\b|->\s*float\b")
RLS_OFF = re.compile(r"disable\s+row\s+level\s+security|using\s*\(\s*true\s*\)", re.IGNORECASE)

DESTRUCTIVE_BASH = [
    (re.compile(r"git\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b)"), "git push forçado"),
    (re.compile(r"git\s+reset\s+--hard\b"), "git reset --hard"),
    (re.compile(r"git\s+clean\s+-[a-z]*f"), "git clean -f"),
    (re.compile(r"supabase\s+db\s+reset\b.*--linked"), "reset do banco REMOTO"),
    (re.compile(r"supabase\s+db\s+push\b"), "push de migrations para projeto remoto"),
    (re.compile(r"supabase\s+test\s+db\b.*--linked"), "testes (com helpers de teste) no banco REMOTO"),
    (re.compile(r"supabase\s+(projects|branches)\s+delete\b"), "exclusão de projeto/branch Supabase"),
    (re.compile(r"\bdrop\s+(database|schema)\b", re.IGNORECASE), "DROP DATABASE/SCHEMA"),
    (re.compile(r"\btruncate\b", re.IGNORECASE), "TRUNCATE"),
    (re.compile(r"rm\s+-[a-z]*r[a-z]*f?\s+(/|~|\$HOME|\.\.?/?)(\s|$)"), "rm -rf em diretório raiz"),
    (re.compile(r"(vercel|railway)\b.*(--prod\b|\bup\b|\bdeploy\b)"), "deploy manual (deve ser via pipeline)"),
    (re.compile(r"docker\s+compose\b.*\bdown\b.*(-v\b|--volumes\b)"), "docker compose down com volumes (apaga o banco)"),
    (re.compile(r"docker\s+(volume\s+(rm|prune)|system\s+prune)\b"), "remoção de volumes Docker"),
    (re.compile(r"\bdbmate\b.*\bdrop\b"), "dbmate drop (apaga o banco)"),
    (re.compile(r"compose\.prod\.yml|ssh\s+\S*(vps|prod)"), "comando em produção (deve ser via pipeline)"),
]


def rel(path: str) -> str:
    try:
        return str(PurePosixPath(os.path.relpath(path, PROJECT_DIR)))
    except ValueError:
        return path


def tracked_in_main(path: str) -> bool:
    result = subprocess.run(
        ["git", "-C", PROJECT_DIR, "cat-file", "-e", f"main:{path}"],
        capture_output=True,
        check=False,
    )
    return result.returncode == 0


def new_text(tool_input: dict[str, object]) -> str:
    parts: list[str] = []
    for key in ("content", "new_string"):
        value = tool_input.get(key)
        if isinstance(value, str):
            parts.append(value)
    edits = tool_input.get("edits")
    if isinstance(edits, list):
        parts.extend(e.get("new_string", "") for e in edits if isinstance(e, dict))
    return "\n".join(parts)


def block(msg: str) -> None:
    print(f"[guard] BLOQUEADO: {msg} Veja AGENTS.md §3. Não contorne: explique ao Adriano.", file=sys.stderr)
    sys.exit(2)


def ask(msg: str) -> None:
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": f"[guard] Comando destrutivo: {msg}. Exige autorização explícita do Adriano.",
        }
    }
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0)


def check_file(tool_input: dict[str, object]) -> None:
    raw = tool_input.get("file_path")
    if not isinstance(raw, str):
        return
    path = rel(raw)
    name = PurePosixPath(path).name
    text = new_text(tool_input)

    if re.fullmatch(r"\.env(\..+)?", name) and not name.endswith((".example", ".sample")):
        block(f"edição de arquivo de segredos ({path}). Use o .env.example correspondente.")

    if path.startswith(("apps/web/", "packages/shared/")) and SECRET_IN_APP.search(text):
        block(f"credencial de banco/S3/chave-mestra/service role no front, que vai para o bundle público ({path}).")

    is_test = re.search(r"(\.spec\.ts|\.e2e-spec\.ts)$", path) or path.startswith("apps/api/test/")
    if path.startswith("apps/api/") and not is_test and SECRET_IN_API.search(text):
        block(f"credencial de vv_worker/vv_owner na API, que só usa vv_api ({path}).")

    if path.startswith(MIGRATION_DIRS) and path.endswith(".sql"):
        if tracked_in_main(path):
            block(f"migration já aplicada no main é imutável ({path}). Crie uma nova migration.")
        if RLS_OFF.search(text):
            block(f"desligar RLS ou policy using(true) ({path}).")

    if path.startswith("apps/worker/src/worker/rules/") and FLOAT_MONEY.search(text):
        block(f"float em rules/ ({path}). Use decimal.Decimal.")


def check_bash(tool_input: dict[str, object]) -> None:
    command = tool_input.get("command")
    if not isinstance(command, str):
        return
    for pattern, label in DESTRUCTIVE_BASH:
        if pattern.search(command):
            ask(label)


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)
    tool = payload.get("tool_name", "")
    tool_input = payload.get("tool_input") or {}
    if tool in {"Write", "Edit", "MultiEdit"}:
        check_file(tool_input)
    elif tool == "Bash":
        check_bash(tool_input)
    sys.exit(0)


if __name__ == "__main__":
    main()
