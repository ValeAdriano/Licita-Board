#!/usr/bin/env bash
# Chamado pelo entrypoint do postgres na primeira inicialização do volume. As senhas são lidas do
# ambiente pelo próprio psql (\getenv), sem passar pela linha de comando.
set -euo pipefail
# Em produção as senhas vêm de arquivos (Docker secrets, ADR-015): VV_X_PASSWORD_FILE=/run/secrets/...
for v in VV_OWNER_PASSWORD VV_API_PASSWORD VV_WORKER_PASSWORD; do
  arq="${v}_FILE"
  if [ -n "${!arq:-}" ]; then
    if [ -n "${!v:-}" ]; then echo "$v e $arq ao mesmo tempo" >&2; exit 1; fi
    export "$v=$(cat "${!arq}")"
  fi
done
: "${VV_OWNER_PASSWORD:?defina VV_OWNER_PASSWORD}" "${VV_API_PASSWORD:?defina VV_API_PASSWORD}"
: "${VV_WORKER_PASSWORD:?defina VV_WORKER_PASSWORD}"
export VV_DB="${VV_DB:-vv}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -f /docker-entrypoint-initdb.d/01_papeis.sql.inc
