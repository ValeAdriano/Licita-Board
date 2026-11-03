#!/usr/bin/env bash
# Registra o verificador da chave-mestra (KEK, ADR-017) no banco, como vv_owner. Uma vez por versão,
# no deploy de cada ambiente. A KEK vem do ambiente (VV_KEK) e nunca é gravada: só o verificador.
# Uso: VV_KEK=... DATABASE_URL=postgres://vv_owner:...@host/vv db/scripts/registrar-kek.sh [versao]
set -euo pipefail
: "${VV_KEK:?defina VV_KEK}" "${DATABASE_URL:?defina DATABASE_URL (vv_owner)}"
VERSAO="${1:-1}"
case "$VERSAO" in ''|*[!0-9]*) echo "versão inválida: $VERSAO" >&2; exit 2 ;; esac
# \bind (psql 16+): a KEK vai como parâmetro, nunca como literal no texto do SQL (log de erro).
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -v versao="$VERSAO" <<'SQL'
\getenv kek VV_KEK
select core.registrar_kek($1::int, $2) \bind :versao :'kek' \g
SQL
echo "Verificador da KEK versão $VERSAO registrado."
