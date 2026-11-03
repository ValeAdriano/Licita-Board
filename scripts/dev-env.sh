#!/usr/bin/env bash
# Gera o .env de DESENVOLVIMENTO com senhas aleatórias (AGENTS.md §3.4: nada de senha no repositório).
# Não sobrescreve um .env existente.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -e .env ]; then echo ".env já existe; nada a fazer." >&2; exit 0; fi
umask 077
{
  echo "# Gerado por scripts/dev-env.sh em $(date +%F). Só desenvolvimento local; nunca versionar."
  for v in POSTGRES_PASSWORD VV_OWNER_PASSWORD VV_API_PASSWORD VV_WORKER_PASSWORD VV_KEK; do
    echo "$v=$(openssl rand -hex 24)"
  done
} > .env
echo ".env criado."
