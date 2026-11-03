#!/usr/bin/env bash
# Recria um banco descartável, aplica db/init + db/migrations com o dbmate de verdade (up, rollback,
# up) e roda os testes pgTAP. Serve para o Postgres do compose, o do CI e um Postgres 16+ local.
#
# Requisitos: Postgres com pgTAP (pgvector opcional), superusuário acessível, Node (npx dbmate).
# Variáveis: PGHOST (127.0.0.1), PGPORT (5432), PGUSER (postgres), PSQL (psql), VV_TEST_DB (vv_test).
# O banco VV_TEST_DB é APAGADO e recriado. As senhas dos papéis vv_* são trocadas por aleatórias;
# exportamos VV_API_PASSWORD para quem chamar (ex.: e2e da API).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="${PSQL:-psql}"
DB="${VV_TEST_DB:-vv_test}"
DBMATE="${DBMATE:-npx --yes dbmate@2.37.0}"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
run() { "$PSQL" -X -q -v ON_ERROR_STOP=1 "$@"; }

case "$DB" in postgres|template0|template1|vv) echo "VV_TEST_DB inválido: $DB" >&2; exit 2 ;; esac

run -d postgres -c "drop database if exists \"$DB\" with (force)"
export VV_DB="$DB" VV_OWNER_PASSWORD="$(openssl rand -hex 16)" VV_API_PASSWORD="$(openssl rand -hex 16)"
export VV_WORKER_PASSWORD="$(openssl rand -hex 16)"
run -d postgres -f "$ROOT/db/init/01_papeis.sql.inc" >/dev/null

export DATABASE_URL="postgres://vv_owner:$VV_OWNER_PASSWORD@$PGHOST:$PGPORT/$DB?sslmode=disable"
export DBMATE_MIGRATIONS_DIR="$ROOT/db/migrations" DBMATE_MIGRATIONS_TABLE=dbmate.schema_migrations
export DBMATE_NO_DUMP_SCHEMA=true
# Sobe tudo, desce a última e sobe de novo: o "-- migrate:down" também é testado.
$DBMATE --wait up >/dev/null && $DBMATE rollback >/dev/null && $DBMATE up >/dev/null \
  || { echo "MIGRATIONS FALHARAM (dbmate up/rollback/up)" >&2; exit 1; }

fail=0
while IFS= read -r t; do
  out="$(run -d "$DB" -At -f "$t" 2>&1 || true)"
  n="$(grep -c '^ok' <<<"$out" || true)"
  if grep -qE '^not ok|ERROR|Looks like' <<<"$out" || [ "$n" -eq 0 ]; then
    echo "FALHOU ${t#$ROOT/}"; grep -E '^not ok|ERROR|Looks like|^#' <<<"$out" || echo "  (0 asserções)"
    fail=1
  else
    echo "ok     ${t#$ROOT/} ($n asserções)"
  fi
done < <(find "$ROOT/db/tests" -name '*.test.sql' | sort)
exit $fail
