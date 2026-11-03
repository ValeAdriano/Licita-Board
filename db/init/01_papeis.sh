#!/usr/bin/env bash
# Chamado pelo entrypoint do postgres na primeira inicialização do volume. As senhas são lidas do
# ambiente pelo próprio psql (\getenv), sem passar pela linha de comando.
set -euo pipefail
: "${VV_OWNER_PASSWORD:?defina VV_OWNER_PASSWORD}" "${VV_API_PASSWORD:?defina VV_API_PASSWORD}"
: "${VV_WORKER_PASSWORD:?defina VV_WORKER_PASSWORD}"
export VV_DB="${VV_DB:-vv}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -f /docker-entrypoint-initdb.d/01_papeis.sql.inc
