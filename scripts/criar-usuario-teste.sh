#!/usr/bin/env bash
# Cria (uma vez) o usuário de TESTE dos agentes, com empresa fictícia e todas as permissões, só em desenvolvimento.
# E-mail e senha ficam em .env.teste (fora do git). Agentes testam SEMPRE com esta conta, nunca com a conta pessoal
# do Adriano (acsvalefilho@gmail.com): ver AGENTS.md regra 19. Idempotente: se .env.teste existe, não faz nada.
#   scripts/criar-usuario-teste.sh          # cria
#   set -a && . ./.env.teste && set +a      # carrega VV_TESTE_EMAIL e VV_TESTE_SENHA
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env.teste ]; then echo ".env.teste já existe (usuário de teste criado). Nada a fazer."; exit 0; fi
set -a && . ./.env && set +a
EMAIL="agente.teste@exemplo.com.br"
# 8+ caracteres, com letra, número e um especial; evita sequências comuns (a API consulta senhas vazadas).
SENHA="Vv$(openssl rand -hex 6)#$(openssl rand -hex 3)"
DATABASE_URL="postgres://vv_owner:$VV_OWNER_PASSWORD@localhost:5433/vv" VV_NOVA_SENHA="$SENHA" \
  node scripts/criar-usuario.mjs --email "$EMAIL" --nome "Agente Teste" --ficticio >/dev/null
umask 077
printf 'VV_TESTE_EMAIL=%s\nVV_TESTE_SENHA=%s\n' "$EMAIL" "$SENHA" > .env.teste
echo "Usuário de teste criado: $EMAIL (senha em .env.teste, fora do git)."
