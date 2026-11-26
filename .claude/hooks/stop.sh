#!/usr/bin/env bash
# Stop: antes do Claude encerrar, roda os testes afetados pelo diff.
# Desligar: touch .claude/NO_STOP_TESTS
INPUT="$(cat)"
ACTIVE="$(printf '%s' "$INPUT" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("stop_hook_active", False))' 2>/dev/null)"
[ "$ACTIVE" = "True" ] && exit 0
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$ROOT" || exit 0
[ -f .claude/ALLOW_TESTS ] || exit 0
[ -f .claude/NO_STOP_TESTS ] && exit 0
# Só roda se houver mudança de código não commitada
CHANGED="$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null \
  | grep -Ev '^\.claude/|\.(md|txt|json|lock|ya?ml)$' )"
[ -z "$CHANGED" ] && exit 0
bash .claude/bin/test.sh changed --quiet || { echo "Testes afetados falharam. Corrija antes de encerrar." >&2; exit 2; }
