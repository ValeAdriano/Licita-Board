#!/usr/bin/env bash
# Sobe o VV Licitações no Railway (ADR-022). Roda na sua máquina, uma vez; depois, push no main já publica.
# Antes: `npm i -g @railway/cli`, `railway login` e dar ao Railway acesso ao repositório no GitHub.
# Pode rodar de novo: valor que já existe no Railway não é trocado.
set -euo pipefail
cd "$(dirname "$0")/../.."
command -v railway >/dev/null || { echo "instale a CLI: npm i -g @railway/cli && railway login" >&2; exit 1; }

npm ci --prefix .railway
railway status >/dev/null 2>&1 || railway init --name vv-licitacoes
railway config apply "$@"   # sem terminal: subir.sh --yes

existe() { railway variable list --service "$1" --kv 2>/dev/null | grep -q "^$2=."; }
gravar() { # serviço nome valor  (pelo stdin: o segredo não aparece na lista de processos)
  printf '%s' "$3" | railway variable set "$2" --stdin --service "$1" --skip-deploys >/dev/null
  echo "  + $1.$2"
}
gerar() { existe "$1" "$2" || gravar "$1" "$2" "$(openssl rand -hex 32)"; }
perguntar() { # serviço nome pergunta [visivel]
  existe "$1" "$2" && return
  local v=""
  if [ -n "${4:-}" ]; then read -rp "  $3: " v || true; else read -rsp "  $3: " v || true; echo; fi
  if [ -n "$v" ]; then gravar "$1" "$2" "$v"; else echo "    (vazio: $1.$2 não definido)"; fi
}

echo "== Segredos gerados"
for n in POSTGRES_PASSWORD VV_OWNER_PASSWORD VV_API_PASSWORD VV_WORKER_PASSWORD; do gerar postgres "$n"; done
gerar api VV_KEK

echo "== Cloudflare Turnstile (obrigatório)"
perguntar web VITE_TURNSTILE_SITEKEY "chave do site (pública)" v
perguntar api TURNSTILE_SECRET "chave secreta"
echo "== S3 externo, ex. Cloudflare R2 (obrigatório para documentos)"
perguntar api S3_ENDPOINT "endpoint, só a origem (https://<conta>.r2.cloudflarestorage.com)" v
perguntar api S3_BUCKET "nome do bucket" v
perguntar api S3_ACCESS_KEY "access key"
perguntar api S3_SECRET_KEY "secret key"
echo "== SMTP (obrigatório para o worker; o Railway só libera SMTP no plano Pro)"
perguntar worker VV_SMTP_HOST "servidor" v
perguntar worker VV_SMTP_USUARIO "usuário"
perguntar worker VV_SMTP_SENHA "senha"
perguntar worker VV_EMAIL_REMETENTE "remetente, ex. VV Licitações <nao-responda@seudominio.com.br>" v
echo "== Primeiro administrador (MFA no primeiro login)"
perguntar migracoes VV_SUPERADMIN_EMAIL "seu e-mail" v
perguntar migracoes VV_NOVA_SENHA "senha (8+, com caractere especial)"

echo "== Domínio público"
railway domain --service web --port 8080 || echo "  (já existe, ou gere no painel: serviço web > Settings > Networking, porta 8080)"

echo "== Publicando"
for s in postgres api worker clamav web migracoes; do
  railway redeploy --service "$s" --yes || echo "  ! redeploy de $s falhou: faça pelo painel"
done
cat <<'FIM'

Falta, à mão:
  1. No R2/S3: liberar CORS (PUT e GET) para o endereço público do serviço web.
  2. No Turnstile: adicionar esse mesmo domínio.
  3. Guardar a VV_KEK num cofre (painel > api > Variables). Sem ela os segredos cifrados não abrem.
  4. Depois do primeiro login, apagar VV_NOVA_SENHA do serviço migracoes.
  5. No painel, ligar backup do volume do postgres.
FIM
