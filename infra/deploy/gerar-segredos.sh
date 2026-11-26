#!/usr/bin/env bash
# Cria os arquivos de segredo da produção, um por segredo (Docker secrets, ADR-015). Roda NO SERVIDOR,
# como root, uma vez. Nunca sobrescreve um arquivo que já existe (trocar segredo é rotação: ver
# docs/operacao/producao.md). Nada é impresso: os valores ficam só nos arquivos.
#
# Uso: sudo infra/deploy/gerar-segredos.sh [pasta]      (padrão /etc/vv/segredos)
#
# - Senhas dos papéis do banco e a chave-mestra (KEK) são geradas aqui, aleatórias.
# - Credenciais de serviços externos (Turnstile, S3, SMTP) são pedidas no terminal, sem eco.
# - Opcionais (IA, Web Push): Enter em branco cria o arquivo vazio = recurso desligado.
# Permissões: pasta 0700 de root (ninguém no servidor chega aos arquivos); arquivos 0444, porque o
# Docker os monta como estão e o processo do container (node, worker, postgres) precisa lê-los.
set -euo pipefail
umask 077
P="${1:-/etc/vv/segredos}"
[ "$(id -u)" = 0 ] || { echo "rode como root (sudo)" >&2; exit 1; }
command -v openssl >/dev/null || { echo "falta o openssl" >&2; exit 1; }

install -d -m 0700 -o root -g root "$P"

gravar() { # nome valor
  local arq="$P/$1"
  if [ -e "$arq" ]; then echo "  = mantido: $1"; return; fi
  printf '%s' "$2" > "$arq"
  chmod 0444 "$arq"
  echo "  + criado:  $1"
}
aleatorio() { openssl rand -hex 32; }   # hex: entra em URL sem escape
perguntar() { # nome descrição obrigatório(1/0)
  local arq="$P/$1" v=""
  if [ -e "$arq" ]; then echo "  = mantido: $1"; return; fi
  while :; do
    read -rsp "  $2: " v; echo
    [ -n "$v" ] || [ "$3" = 0 ] && break
    echo "    obrigatório."
  done
  gravar "$1" "$v"
}
ler() { cat "$P/$1"; }

echo "Banco e chave-mestra (gerados):"
gravar postgres_password "$(aleatorio)"
gravar vv_owner_password "$(aleatorio)"
gravar vv_api_password "$(aleatorio)"
gravar vv_worker_password "$(aleatorio)"
gravar vv_api_database_url "postgres://vv_api:$(ler vv_api_password)@postgres:5432/vv?sslmode=disable"
gravar vv_worker_database_url "postgresql://vv_worker:$(ler vv_worker_password)@postgres:5432/vv"
gravar vv_kek "$(openssl rand -base64 48 | tr -d '\n')"

echo "Serviços externos (digite; nada aparece na tela):"
perguntar turnstile_secret "Cloudflare Turnstile: chave SECRETA" 1
perguntar s3_api_access_key "S3: access key da API (ler e gravar no bucket)" 1
perguntar s3_api_secret_key "S3: secret key da API" 1
perguntar s3_worker_access_key "S3: access key do worker (ler, gravar, listar)" 1
perguntar s3_worker_secret_key "S3: secret key do worker" 1
perguntar smtp_usuario "SMTP: usuário" 1
perguntar smtp_senha "SMTP: senha" 1

echo "Opcionais (Enter em branco = desligado):"
perguntar anthropic_api_key "Anthropic: chave da IA da plataforma (cada empresa também pode cadastrar a sua)" 0
perguntar vapid_private_key "Web Push: chave PRIVADA VAPID" 0

cat <<EOF

Pronto em $P.
AGORA, antes do primeiro deploy: copie para o cofre (fora do servidor, com duas pessoas) a chave-mestra
  sudo cat $P/vv_kek
Sem ela, os segredos cifrados do banco e dos backups não abrem. Não guarde junto do bucket de backup.
EOF
