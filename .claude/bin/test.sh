#!/usr/bin/env bash
# Runner de testes em blocos. Detecta a stack (Python/pytest, Django, Node/vitest/jest).
# Uso: test.sh file <arquivo> | block <nome> | changed | all   [--quiet]
# Override: .claude/test-commands.env (TEST_PREFIX, TEST_ALL, TEST_CHANGED, TEST_FILE com {F})
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 1

MODE="${1:-}"; ARG="${2:-}"; QUIET=0
for a in "$@"; do [ "$a" = "--quiet" ] && QUIET=1; done
[ "$ARG" = "--quiet" ] && ARG=""

die() { echo "test.sh: $*" >&2; exit 1; }

# ---------- Trava de produção ----------
if [ ! -f "$ROOT/.claude/ALLOW_TESTS" ]; then
  [ "$QUIET" = 1 ] && exit 0
  die "testes bloqueados: falta .claude/ALLOW_TESTS (crie só em máquina de dev: touch .claude/ALLOW_TESTS)"
fi

# ---------- Overrides ----------
TEST_PREFIX=""; TEST_ALL=""; TEST_CHANGED=""; TEST_FILE=""
[ -f .claude/test-commands.env ] && . ./.claude/test-commands.env

# ---------- Detecção de stack ----------
has() { command -v "$1" >/dev/null 2>&1; }
STACK=""
if [ -f package.json ]; then
  if grep -q '"vitest"' package.json; then STACK="vitest"
  elif grep -q '"jest"' package.json; then STACK="jest"
  else STACK="npm"; fi
fi
if [ -z "$STACK" ]; then
  if [ -f pytest.ini ] || [ -f conftest.py ] || grep -qs '\[tool.pytest' pyproject.toml; then STACK="pytest"
  elif [ -f manage.py ]; then STACK="django"
  elif ls ./*.py pyproject.toml requirements*.txt >/dev/null 2>&1; then STACK="pytest"; fi
fi

# Base para "changed": merge-base com origin/main, main ou master
base_ref() {
  for r in origin/main main origin/master master; do
    git rev-parse --verify -q "$r" >/dev/null && { git merge-base HEAD "$r"; return; }
  done
  echo HEAD
}
changed_files() {
  { git diff --name-only "$(base_ref)"; git ls-files --others --exclude-standard; } | sort -u
}

py_related_tests() {  # arquivos de teste relacionados a um .py
  local f="$1" stem
  case "$f" in *test_*.py|*_test.py|*/tests/*.py) [ -f "$f" ] && echo "$f"; return;; esac
  stem="$(basename "$f" .py)"
  git ls-files | grep -E "(^|/)(test_${stem}|${stem}_test)\.py$" || true
}
pytest_has_testmon() { python3 -c "import testmon" >/dev/null 2>&1; }

# ---------- Monta o comando ----------
CMD=""
case "$MODE" in
  block)
    [ -n "$ARG" ] || die "uso: make test-block B=<nome>  (blocos em .claude/test-blocks.tsv)"
    [ -f .claude/test-blocks.tsv ] || die "sem .claude/test-blocks.tsv"
    CMD="$(awk -F'\t' -v b="$ARG" '$1==b {print $2; exit}' .claude/test-blocks.tsv)"
    [ -n "$CMD" ] || die "bloco '$ARG' não encontrado em .claude/test-blocks.tsv"
    ;;
  file)
    [ -n "$ARG" ] || die "uso: make test-file F=<arquivo>"
    if [ -n "$TEST_FILE" ]; then CMD="${TEST_FILE//\{F\}/$ARG}"
    else case "$STACK" in
      vitest) CMD="npx vitest related '$ARG' --run --passWithNoTests" ;;
      jest)   CMD="npx jest --findRelatedTests '$ARG' --passWithNoTests" ;;
      pytest)
        case "$ARG" in *.py) ;; *) exit 0;; esac
        T="$(py_related_tests "$ARG" | tr '\n' ' ')"
        if [ -n "$T" ]; then CMD="python3 -m pytest -x -q --tb=short $T"
        elif pytest_has_testmon; then CMD="python3 -m pytest --testmon -x -q --tb=short"
        else [ "$QUIET" = 1 ] || echo "sem teste relacionado a $ARG"; exit 0; fi ;;
      django)
        APP="$(echo "$ARG" | sed -E 's#^(apps/)?([^/]+)/.*#\1\2#; s#/#.#g')"
        CMD="python3 manage.py test $APP --keepdb --failfast --noinput" ;;
      npm) CMD="npm test --silent" ;;
      *) die "stack não detectada: configure .claude/test-commands.env" ;;
    esac; fi
    ;;
  changed)
    if [ -n "$TEST_CHANGED" ]; then CMD="$TEST_CHANGED"
    else case "$STACK" in
      vitest) CMD="npx vitest --changed $(base_ref) --run --passWithNoTests" ;;
      jest)   CMD="npx jest --changedSince=$(base_ref) --passWithNoTests" ;;
      pytest)
        if pytest_has_testmon; then CMD="python3 -m pytest --testmon -x -q --tb=short"
        else
          T="$(changed_files | grep '\.py$' | while read -r f; do py_related_tests "$f"; done | sort -u | tr '\n' ' ')"
          [ -n "${T// /}" ] || { [ "$QUIET" = 1 ] || echo "nenhum teste afetado"; exit 0; }
          CMD="python3 -m pytest -x -q --tb=short $T"
        fi ;;
      django)
        APPS="$(changed_files | grep '\.py$' | sed -E 's#^(apps/)?([^/]+)/.*#\1\2#; s#/#.#g' | grep -v '\.py$' | sort -u | tr '\n' ' ')"
        [ -n "${APPS// /}" ] || { [ "$QUIET" = 1 ] || echo "nenhum app alterado"; exit 0; }
        CMD="python3 manage.py test $APPS --keepdb --failfast --noinput" ;;
      npm) CMD="npm test --silent" ;;
      *) die "stack não detectada: configure .claude/test-commands.env" ;;
    esac; fi
    ;;
  all)
    if [ -n "$TEST_ALL" ]; then CMD="$TEST_ALL"
    else case "$STACK" in
      vitest) CMD="npx vitest --run" ;;
      jest)   CMD="npx jest" ;;
      pytest) CMD="python3 -m pytest -q --tb=short" ;;
      django) CMD="python3 manage.py test --keepdb --noinput" ;;
      npm)    CMD="npm test --silent" ;;
      *) die "stack não detectada: configure .claude/test-commands.env" ;;
    esac; fi
    ;;
  *) die "uso: test.sh file <arquivo> | block <nome> | changed | all [--quiet]" ;;
esac

[ -n "$TEST_PREFIX" ] && CMD="$TEST_PREFIX $CMD"

# ---------- Executa ----------
if [ "$QUIET" = 1 ]; then
  OUT="$(CI=1 bash -c "$CMD" 2>&1)"; RC=$?
  [ $RC -eq 0 ] && exit 0
  echo "FALHOU: $CMD" >&2
  # Só as linhas que importam, sem repetir (economiza contexto)
  echo "$OUT" | grep -E "FAIL|Error|error|assert|Assert|✗|×|failed|Traceback|^E |^>" \
    | awk '!seen[$0]++' | head -30 >&2
  exit $RC
else
  echo "▶ $CMD"
  CI=1 bash -c "$CMD"
fi
