#!/usr/bin/env bash
# Cria o PRIMEIRO usuário SUPERADMIN em produção (a API não cria usuário fora de convite). Roda NO SERVIDOR,
# como root, depois do primeiro deploy. Usa scripts/criar-usuario.mjs dentro da imagem da API (que tem as
# dependências) numa rede interna, com a senha do dono (vv_owner) lida do arquivo de segredo.
#
# Uso: sudo infra/deploy/criar-superadmin.sh --email voce@empresa.com.br --nome "Seu Nome"
# A senha inicial aparece UMA vez no terminal. Entre logo em seguida e cadastre o autenticador (MFA).
set -euo pipefail
RAIZ=/opt/vv
[ "$(id -u)" = 0 ] || { echo "rode como root (sudo)" >&2; exit 1; }
[ -t 0 ] && [ -t 1 ] || { echo "rode num terminal interativo (a senha aparece uma vez)" >&2; exit 1; }
versao="$(cat /etc/vv/versao)"
registro="$(. /etc/vv/vv.env; echo "$VV_REGISTRO")"

docker run --rm -it --network vv-prod_interna \
  -e VV_ENV=prod \
  -v /etc/vv/segredos/vv_owner_password:/run/secrets/vv_owner_password:ro \
  -v "$RAIZ/scripts/criar-usuario.mjs:/app/scripts/criar-usuario.mjs:ro" \
  --entrypoint /bin/sh "$registro/vv-api:$versao" \
  -c 'export DATABASE_URL="postgres://vv_owner:$(cat /run/secrets/vv_owner_password)@postgres:5432/vv"; exec node scripts/criar-usuario.mjs "$@" --superadmin' \
  criar-superadmin "$@"
