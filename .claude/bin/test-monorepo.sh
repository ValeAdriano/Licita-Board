#!/usr/bin/env bash
# Roteador de testes do monorepo (apps/web, apps/api, apps/worker).
# Chamado por .claude/bin/test.sh via .claude/test-commands.env.
# Uso: test-monorepo.sh file <arquivo> | changed | all
# Só testes rápidos e locais: e2e da API e pgTAP precisam da stack (use make test-block).
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT" || exit 1
MODE="${1:-}"; F="${2:-}"; RC=0

web_related() { (cd apps/web && npx vitest related "$@" --run --passWithNoTests) || RC=1; }
api_related() { (cd apps/api && npx vitest related "$@" --run --project unit --passWithNoTests) || RC=1; }
worker_tests_for() { # arquivo .py do worker -> testes relacionados (caminhos relativos a apps/worker)
  local f="$1" stem
  case "$f" in apps/worker/tests/test_*.py) [ -f "$f" ] && echo "${f#apps/worker/}"; return;; esac
  stem="$(basename "$f" .py)"
  [ "$stem" = "__init__" ] && return
  git ls-files apps/worker/tests | grep -E "/test_${stem}(_[a-z_]+)?\.py$" | sed 's#^apps/worker/##' || true
}
worker_run() { [ $# -gt 0 ] || return 0; (cd apps/worker && uv run pytest -x -q --tb=short "$@") || RC=1; }

changed_files() { # não commitados + commits ainda não enviados ao origin/main
  { git diff --name-only HEAD
    git ls-files --others --exclude-standard
    git rev-parse -q --verify origin/main >/dev/null && git diff --name-only origin/main...HEAD
  } 2>/dev/null | sort -u
}

case "$MODE" in
  file)
    [ -n "$F" ] || { echo "uso: test-monorepo.sh file <arquivo>" >&2; exit 1; }
    case "$F" in
      apps/web/src/*.ts|apps/web/src/*.tsx) web_related "${F#apps/web/}" ;;
      apps/api/src/*.ts|apps/api/test/*.spec.ts) api_related "${F#apps/api/}" ;;
      apps/worker/*.py) worker_run $(worker_tests_for "$F") ;;
      *) exit 0 ;;  # db/, infra/, packages/, docs: sem teste rápido associado
    esac ;;
  changed)
    CH="$(changed_files)"
    W="$(echo "$CH" | grep -E '^apps/web/src/.*\.tsx?$' | sed 's#^apps/web/##' | tr '\n' ' ')"
    A="$(echo "$CH" | grep -E '^apps/api/(src/.*\.ts|test/.*\.spec\.ts)$' | grep -v 'e2e-spec' | sed 's#^apps/api/##' | tr '\n' ' ')"
    P="$(echo "$CH" | grep -E '^apps/worker/.*\.py$' | while read -r f; do worker_tests_for "$f"; done | sort -u | tr '\n' ' ')"
    [ -n "${W// /}" ] && web_related $W
    [ -n "${A// /}" ] && api_related $A
    [ -n "${P// /}" ] && worker_run $P
    [ -z "${W// /}${A// /}${P// /}" ] && echo "nenhum teste afetado" ;;
  all)
    npm test --prefix apps/web || RC=1
    npm test --prefix apps/api || RC=1
    (cd apps/worker && uv run pytest -q --tb=short) || RC=1 ;;
  *) echo "uso: test-monorepo.sh file <arquivo> | changed | all" >&2; exit 1 ;;
esac
exit $RC
