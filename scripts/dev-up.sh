#!/usr/bin/env bash
# Sobe o sistema INTEIRO em Docker (desenvolvimento): banco, migrations, API, worker, Mailpit, S3, antivírus
# e o front com Caddy. Idempotente: pode rodar de novo a qualquer momento. Precisa do Docker Desktop aberto.
#   App:     http://localhost:8080      E-mails de dev (Mailpit): http://localhost:8025
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/dev-env.sh
set -a && . ./.env && set +a

# Configuração do S3 de dev (SeaweedFS) com as chaves do .env: a API só lê e grava, o worker verifica,
# o admin cria o bucket. Arquivo com segredo: fora do git.
mkdir -p infra/s3
cat > infra/s3/s3.json <<JSON
{"identities":[
 {"name":"admin","credentials":[{"accessKey":"$S3_ADMIN_ACCESS_KEY","secretKey":"$S3_ADMIN_SECRET_KEY"}],"actions":["Admin"]},
 {"name":"api","credentials":[{"accessKey":"$S3_API_ACCESS_KEY","secretKey":"$S3_API_SECRET_KEY"}],"actions":["Read:vv-docs","Write:vv-docs"]},
 {"name":"worker","credentials":[{"accessKey":"$S3_WORKER_ACCESS_KEY","secretKey":"$S3_WORKER_SECRET_KEY"}],"actions":["Read:vv-docs","Write:vv-docs","List:vv-docs"]}]}
JSON
chmod 600 infra/s3/s3.json

docker compose up -d --build postgres
# Alinha as senhas dos papéis com o .env (db/scripts/test-local.sh as troca no servidor); idempotente.
docker compose exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<SQL
alter role vv_owner password '$VV_OWNER_PASSWORD';
alter role vv_api password '$VV_API_PASSWORD';
alter role vv_worker password '$VV_WORKER_PASSWORD';
SQL
docker compose run --rm dbmate up
# Verificador da chave-mestra: só no banco novo (com o banco já registrado, nada a fazer).
if [ "$(docker compose exec -T postgres psql -U postgres -d vv -Atc 'select count(*) from core.chaves_mestras')" = 0 ]; then
  docker compose exec -T -e VV_KEK="$VV_KEK" \
    -e DATABASE_URL="postgres://vv_owner:$VV_OWNER_PASSWORD@localhost:5432/vv" postgres /db/scripts/registrar-kek.sh
fi
docker compose up -d --build
docker compose run --rm s3-init

echo
docker compose ps
echo
echo "App:     http://localhost:8080"
echo "E-mails: http://localhost:8025"
echo "Primeiro usuário (SUPERADMIN) e empresa fictícia:"
echo "  export DATABASE_URL=\"postgres://vv_owner:\$VV_OWNER_PASSWORD@localhost:5433/vv\"   # depois de: set -a && . ./.env && set +a"
echo "  node scripts/criar-usuario.mjs --email voce@exemplo.com --nome \"Seu Nome\" --superadmin --ficticio"
