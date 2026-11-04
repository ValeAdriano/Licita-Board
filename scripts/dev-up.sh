#!/usr/bin/env bash
# Sobe o sistema INTEIRO em Docker (desenvolvimento): banco, migrations, API, worker, Mailpit e o front
# com Caddy. Idempotente: pode rodar de novo a qualquer momento. Precisa de Docker (ex.: `colima start`).
#   App:     http://localhost:8080      E-mails de dev (Mailpit): http://localhost:8025
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/dev-env.sh
set -a && . ./.env && set +a

docker compose up -d --build postgres
docker compose run --rm dbmate up
# Verificador da chave-mestra: só no banco novo (com o banco já registrado, nada a fazer).
if [ "$(docker compose exec -T postgres psql -U postgres -d vv -Atc 'select count(*) from core.chaves_mestras')" = 0 ]; then
  docker compose exec -T -e VV_KEK="$VV_KEK" \
    -e DATABASE_URL="postgres://vv_owner:$VV_OWNER_PASSWORD@localhost:5432/vv" postgres /db/scripts/registrar-kek.sh
fi
docker compose up -d --build
docker compose run --rm minio-init

echo
docker compose ps
echo
echo "App:     http://localhost:8080"
echo "E-mails: http://localhost:8025      Arquivos (MinIO): http://localhost:9001"
echo "Primeiro usuário (SUPERADMIN) e empresa fictícia:"
echo "  export DATABASE_URL=\"postgres://vv_owner:\$VV_OWNER_PASSWORD@localhost:5433/vv\"   # depois de: set -a && . ./.env && set +a"
echo "  node scripts/criar-usuario.mjs --email voce@exemplo.com --nome \"Seu Nome\" --superadmin --ficticio"
