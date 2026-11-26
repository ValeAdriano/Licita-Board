#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): roda só os testes relacionados ao arquivo editado.
# Devolve apenas as falhas (exit 2 = Claude vê o erro e corrige).
INPUT="$(cat)"
F="$(printf '%s' "$INPUT" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null)"
[ -z "$F" ] && exit 0
ROOT="$(git -C "$(dirname "$F")" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -f "$ROOT/.claude/ALLOW_TESTS" ] || exit 0
REL="${F#$ROOT/}"
case "$REL" in
  .claude/*|*.md|*.txt|*.json|*.lock|*.yml|*.yaml|*.css|*.svg|*.png|*.jpg) exit 0 ;;
esac
cd "$ROOT" && bash .claude/bin/test.sh file "$REL" --quiet || exit 2
