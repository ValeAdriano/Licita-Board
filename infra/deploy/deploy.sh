#!/usr/bin/env bash
# Deploy de uma versão no servidor de produção (ADR-015). Roda NO SERVIDOR, como root.
#
# Uso: sudo /opt/vv/infra/deploy/deploy.sh <versão>       (versão = tag publicada pelo workflow imagens.yml)
#      sudo /opt/vv/infra/deploy/deploy.sh --voltar        (volta para a versão anterior)
#      sudo /opt/vv/infra/deploy/deploy.sh --status
#
# Passos: confere configuração e segredos → atualiza /opt/vv para a tag (compose e configuração de backup)
# → baixa as imagens → backup completo antes das migrations (se o backup estiver ligado) → migrations →
# KEK (só no banco novo) → sobe → espera tudo saudável → confere https://<domínio>/api/health.
# Falhou depois de trocar as imagens: volta sozinho para a versão anterior (as migrations NÃO voltam:
# cada migration precisa ser compatível com o código da versão anterior; ver docs/operacao/producao.md).
set -euo pipefail
RAIZ=/opt/vv
CONF=/etc/vv/vv.env
SEGREDOS=/etc/vv/segredos
ESTADO=/etc/vv/versao
BACKUP_ENV=/etc/vv/backup.env
[ "$(id -u)" = 0 ] || { echo "rode como root (sudo)" >&2; exit 1; }
[ -r "$CONF" ] || { echo "falta $CONF (modelo: infra/deploy/vv.env.example)" >&2; exit 1; }
cd "$RAIZ"

arquivos=(-f "$RAIZ/infra/compose.prod.yml")
if [ -r "$BACKUP_ENV" ]; then
  arquivos+=(-f "$RAIZ/infra/backup/compose.backup.yml")
  export VV_BACKUP_ENV_FILE="$BACKUP_ENV"
fi
export VV_SEGREDOS="$SEGREDOS"
dc() { docker compose --project-directory "$RAIZ" --env-file "$CONF" "${arquivos[@]}" "$@"; }
versao_atual() { [ -r "$ESTADO" ] && cat "$ESTADO" || true; }

case "${1:-}" in
  --status)
    echo "versão: $(versao_atual)"; VV_VERSAO="$(versao_atual)" dc ps; exit 0 ;;
  --voltar)
    alvo="$(cat "$ESTADO.anterior" 2>/dev/null || true)"
    [ -n "$alvo" ] || { echo "não há versão anterior registrada" >&2; exit 1; } ;;
  "" | -*) echo "uso: deploy.sh <versão> | --voltar | --status" >&2; exit 2 ;;
  *) alvo="$1" ;;
esac
case "$alvo" in *[!A-Za-z0-9._-]*) echo "versão inválida: $alvo" >&2; exit 2 ;; esac
anterior="$(versao_atual)"

echo "== Conferência"
faltam=()
for s in postgres_password vv_owner_password vv_api_password vv_worker_password vv_api_database_url \
  vv_worker_database_url vv_kek turnstile_secret s3_api_access_key s3_api_secret_key s3_worker_access_key \
  s3_worker_secret_key smtp_usuario smtp_senha vapid_private_key anthropic_api_key; do
  [ -e "$SEGREDOS/$s" ] || faltam+=("$s")
done
[ ${#faltam[@]} = 0 ] || { echo "faltam segredos: ${faltam[*]} (rode infra/deploy/gerar-segredos.sh)" >&2; exit 1; }
[ "$(stat -c %a "$SEGREDOS")" = 700 ] || { echo "$SEGREDOS precisa ser 0700" >&2; exit 1; }
dominio="$(. "$CONF"; echo "${VV_DOMINIO:-}")"
[ -n "$dominio" ] || { echo "VV_DOMINIO vazio em $CONF" >&2; exit 1; }

echo "== Código de configuração na tag $alvo"
# Só compose e configuração de backup vêm do repositório; o código roda das imagens.
git -C "$RAIZ" fetch --quiet --tags origin
git -C "$RAIZ" -c advice.detachedHead=false checkout --quiet "refs/tags/$alvo" 2>/dev/null \
  || git -C "$RAIZ" -c advice.detachedHead=false checkout --quiet "$alvo"

export VV_VERSAO="$alvo"
echo "== Imagens $alvo"
dc --profile ferramentas pull --quiet

subiu=0
voltar() {
  local motivo="$1"
  echo "!! $motivo" >&2
  if [ "$subiu" = 1 ] && [ -n "$anterior" ] && [ "$anterior" != "$alvo" ]; then
    echo "!! voltando para $anterior (as migrations aplicadas continuam)" >&2
    git -C "$RAIZ" -c advice.detachedHead=false checkout --quiet "refs/tags/$anterior" 2>/dev/null || true
    VV_VERSAO="$anterior" dc up -d --remove-orphans || true
  fi
  exit 1
}

dc up -d postgres
if [ -r "$BACKUP_ENV" ] && [ -n "$anterior" ]; then
  echo "== Backup completo antes das migrations"
  VV_COMPOSE="docker compose --project-directory $RAIZ --env-file $CONF ${arquivos[*]}" \
    "$RAIZ/infra/backup/rodar-backup.sh" full || voltar "backup antes do deploy falhou: nada foi alterado"
fi

echo "== Migrations"
dc run --rm migracoes up || voltar "migrations falharam"

if [ "$(dc exec -T postgres psql -U postgres -d vv -Atc 'select count(*) from core.chaves_mestras')" = 0 ]; then
  echo "== Verificador da chave-mestra (banco novo)"
  dc run --rm kek 1 || voltar "registro da KEK falhou"
fi

echo "== Subindo $alvo"
subiu=1
dc up -d --remove-orphans || voltar "docker compose up falhou"

echo "== Esperando ficar saudável"
for i in $(seq 1 60); do
  ruins="$(dc ps --format '{{.Service}} {{.Health}}' | awk '$1 ~ /^(postgres|api|worker|web|clamav)$/ && $2 != "healthy" && $2 != "" {print $1}')"
  [ -z "$ruins" ] && break
  [ "$i" = 60 ] && voltar "não ficou saudável em 10 min: $ruins"
  sleep 10
done
# Pela porta pública, com o certificado de verdade (o DNS precisa apontar para este servidor).
curl -fsS --max-time 20 --resolve "$dominio:443:127.0.0.1" "https://$dominio/api/health" >/dev/null \
  || voltar "https://$dominio/api/health não respondeu"

[ -n "$anterior" ] && [ "$anterior" != "$alvo" ] && printf '%s' "$anterior" > "$ESTADO.anterior"
printf '%s' "$alvo" > "$ESTADO"
docker image prune -f >/dev/null
echo "== OK: $alvo no ar em https://$dominio (anterior: ${anterior:-nenhuma})"
