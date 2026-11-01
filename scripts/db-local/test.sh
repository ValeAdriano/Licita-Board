#!/usr/bin/env bash
# Roda as migrations e os testes pgTAP num Postgres local, sem Docker.
# Útil para agentes/máquinas sem Docker. O CI continua usando `supabase test db` (Supabase real).
#
# Requisitos: Postgres 16+ com pgTAP instalado e um servidor acessível.
# Variáveis: PGHOST (127.0.0.1), PGPORT (5432), PGUSER (postgres), PSQL (psql), VV_TEST_DB (vv_test).
# O banco VV_TEST_DB é APAGADO e recriado a cada execução.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="${PSQL:-psql}"
DB="${VV_TEST_DB:-vv_test}"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
run() { "$PSQL" -X -q -v ON_ERROR_STOP=1 "$@"; }

case "$DB" in postgres|template0|template1) echo "VV_TEST_DB inválido: $DB" >&2; exit 2 ;; esac

run -d postgres -c "drop database if exists \"$DB\"" -c "create database \"$DB\"" 2>&1 | grep -v NOTICE || true
run -d "$DB" -c "select 1" >/dev/null
sed "s/alter database vvtest/alter database \"$DB\"/" "$ROOT/scripts/db-local/stub_supabase.sql" | run -d "$DB" >/dev/null

for f in "$ROOT"/supabase/migrations/*.sql; do
  run -d "$DB" -1 -f "$f" >/dev/null || { echo "MIGRATION FALHOU: ${f#$ROOT/}" >&2; exit 1; }
done

fail=0
while IFS= read -r t; do
  out="$(run -d "$DB" -At -f "$t" 2>&1 || true)"
  if grep -qE '^not ok|ERROR|Looks like' <<<"$out"; then
    echo "FALHOU ${t#$ROOT/}"; grep -E '^not ok|ERROR|Looks like|^#' <<<"$out" || true; fail=1
  else
    echo "ok     ${t#$ROOT/} ($(grep -c '^ok' <<<"$out") asserções)"
  fi
done < <(find "$ROOT/supabase/tests" -name '*.test.sql' | sort)
exit $fail
