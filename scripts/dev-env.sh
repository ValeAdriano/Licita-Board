#!/usr/bin/env bash
# Gera o .env de DESENVOLVIMENTO com senhas aleatórias (AGENTS.md §3.4: nada de senha no repositório).
# Não sobrescreve um .env existente.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -e .env ]; then
  # Completa um .env antigo com as variáveis novas (S3 de desenvolvimento), sem tocar nas existentes.
  for v in MINIO_ROOT_PASSWORD S3_API_SECRET_KEY S3_WORKER_SECRET_KEY; do
    grep -q "^$v=" .env || echo "$v=$(openssl rand -hex 24)" >> .env
  done
  grep -q "^MINIO_ROOT_USER=" .env || echo "MINIO_ROOT_USER=vvminio" >> .env
  grep -q "^S3_API_ACCESS_KEY=" .env || echo "S3_API_ACCESS_KEY=vvapi" >> .env
  grep -q "^S3_WORKER_ACCESS_KEY=" .env || echo "S3_WORKER_ACCESS_KEY=vvworker" >> .env
  echo ".env já existe; variáveis novas completadas." >&2; exit 0
fi
umask 077
{
  echo "# Gerado por scripts/dev-env.sh em $(date +%F). Só desenvolvimento local; nunca versionar."
  for v in POSTGRES_PASSWORD VV_OWNER_PASSWORD VV_API_PASSWORD VV_WORKER_PASSWORD VV_KEK; do
    echo "$v=$(openssl rand -hex 24)"
  done
} > .env
# Par VAPID do Web Push (ADR-018). Precisa do uv; sem ele o push fica desligado (chaves vazias).
if command -v uv >/dev/null 2>&1; then
  (cd apps/worker && uv run --quiet python scripts/gerar_vapid.py) >> .env \
    || echo "aviso: não foi possível gerar as chaves VAPID; o push fica desligado." >&2
fi
for v in MINIO_ROOT_PASSWORD S3_API_SECRET_KEY S3_WORKER_SECRET_KEY; do echo "$v=$(openssl rand -hex 24)" >> .env; done
{ echo "MINIO_ROOT_USER=vvminio"; echo "S3_API_ACCESS_KEY=vvapi"; echo "S3_WORKER_ACCESS_KEY=vvworker"; } >> .env
echo ".env criado."

