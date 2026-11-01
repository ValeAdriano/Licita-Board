#!/usr/bin/env python3
"""Falha se alguma tabela do schema `priv` não tiver teste de isolamento A x B.

Regra (AGENTS.md §3.13, ADR-003): para cada `create table priv.<nome>` nas migrations,
deve existir `supabase/tests/isolamento/priv_<nome>.test.sql`.
Tabelas removidas depois (`drop table priv.<nome>`) ou renomeadas são acompanhadas.

Uso: python3 scripts/check_isolation_coverage.py [--root <repo>]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

IDENT = r'"?([a-z_][a-z0-9_]*)"?'
CREATE = re.compile(rf"create\s+table\s+(?:if\s+not\s+exists\s+)?\"?priv\"?\.{IDENT}", re.IGNORECASE)
DROP = re.compile(rf"drop\s+table\s+(?:if\s+exists\s+)?\"?priv\"?\.{IDENT}", re.IGNORECASE)
RENAME = re.compile(rf"alter\s+table\s+(?:if\s+exists\s+)?\"?priv\"?\.{IDENT}\s+rename\s+to\s+{IDENT}", re.IGNORECASE)
COMMENT = re.compile(r"--[^\n]*|/\*.*?\*/", re.DOTALL)


def priv_tables(migrations: Path) -> set[str]:
    tables: set[str] = set()
    for path in sorted(migrations.glob("*.sql")):
        sql = COMMENT.sub("", path.read_text(encoding="utf-8"))
        events: list[tuple[int, str, tuple[str, ...]]] = []
        events += [(m.start(), "create", (m.group(1).lower(),)) for m in CREATE.finditer(sql)]
        events += [(m.start(), "drop", (m.group(1).lower(),)) for m in DROP.finditer(sql)]
        events += [(m.start(), "rename", (m.group(1).lower(), m.group(2).lower())) for m in RENAME.finditer(sql)]
        for _, kind, names in sorted(events):
            if kind == "create":
                tables.add(names[0])
            elif kind == "drop":
                tables.discard(names[0])
            elif names[0] in tables:
                tables.discard(names[0])
                tables.add(names[1])
    return tables


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    migrations = args.root / "supabase" / "migrations"
    tests_dir = args.root / "supabase" / "tests" / "isolamento"

    tables = priv_tables(migrations)
    missing = sorted(t for t in tables if not (tests_dir / f"priv_{t}.test.sql").is_file())

    if missing:
        print("Tabelas de priv sem teste de isolamento A x B:", file=sys.stderr)
        for t in missing:
            print(f"  - priv.{t}  ->  supabase/tests/isolamento/priv_{t}.test.sql", file=sys.stderr)
        print("Base: supabase/tests/isolamento/_modelo.sql.example", file=sys.stderr)
        return 1
    print(f"OK: {len(tables)} tabela(s) de priv, todas com teste de isolamento.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
