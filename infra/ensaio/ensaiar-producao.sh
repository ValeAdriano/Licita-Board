#!/usr/bin/env bash
# Ensaia a produção NA MÁQUINA DE DEV: constrói as 5 imagens, gera segredos descartáveis, sobe
# infra/compose.prod.yml (com infra/ensaio/compose.ensaio.yml) e confere o que o deploy confere:
# migrations, verificador da KEK, tudo saudável, /api/health pelo Caddy com TLS e login recusado/aceito.
#
# Uso: infra/ensaio/ensaiar-producao.sh            (sobe, confere e DERRUBA tudo, volumes incluídos)
#      infra/ensaio/ensaiar-producao.sh --manter   (deixa no ar em https://ensaio.vv.test:18443)
# Projeto Compose próprio (vv-ensaio): não toca na stack de desenvolvimento nem nos volumes dela.
set -euo pipefail
cd "$(dirname "$0")/../.."
RAIZ="$PWD"
MANTER=0; [ "${1:-}" = --manter ] && MANTER=1
DIR="$(mktemp -d "${TMPDIR:-/tmp}/vv-ensaio.XXXXXX")"
chmod 700 "$DIR"
export VV_ENSAIO_DIR="$DIR" VV_SEGREDOS="$DIR/segredos" VV_REGISTRO=local VV_VERSAO=ensaio
mkdir -m 700 "$VV_SEGREDOS"

dc() { docker compose -p vv-ensaio --project-directory "$RAIZ" --env-file "$DIR/vv.env" \
  -f infra/compose.prod.yml -f infra/ensaio/compose.ensaio.yml "$@"; }
limpar() {
  if [ "$MANTER" = 0 ]; then dc --profile ferramentas down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$DIR"; fi
}
trap limpar EXIT

echo "== Imagens"
docker build -q -t local/vv-postgres:ensaio --build-arg COM_PGTAP=0 db >/dev/null
docker build -q -t local/vv-migracoes:ensaio -f db/Dockerfile.migracoes db >/dev/null
docker build -q -t local/vv-api:ensaio apps/api >/dev/null
docker build -q -t local/vv-worker:ensaio apps/worker >/dev/null
docker build -q -t local/vv-web:ensaio -f infra/caddy/Dockerfile . >/dev/null

echo "== Configuração e segredos descartáveis"
cat > "$DIR/vv.env" <<EOF
VV_DOMINIO=ensaio.vv.test
VV_ENV=prod
VV_S3_ENDPOINT=http://s3:8333
VV_S3_PUBLIC_URL=https://s3.ensaio.vv.test
VV_S3_BUCKET=vv-docs
VV_SMTP_HOST=mailpit
VV_SMTP_PORT=1025
VV_EMAIL_REMETENTE=VV Ensaio <ensaio@exemplo.test>
VV_ROBO_CONTATO=ensaio@exemplo.test
EOF
s() { printf '%s' "$2" > "$VV_SEGREDOS/$1"; chmod 0444 "$VV_SEGREDOS/$1"; }
h() { openssl rand -hex 32; }
for p in postgres_password vv_owner_password vv_api_password vv_worker_password; do s "$p" "$(h)"; done
s vv_api_database_url "postgres://vv_api:$(cat "$VV_SEGREDOS/vv_api_password")@postgres:5432/vv?sslmode=disable"
s vv_worker_database_url "postgresql://vv_worker:$(cat "$VV_SEGREDOS/vv_worker_password")@postgres:5432/vv"
s vv_kek "$(openssl rand -base64 48 | tr -d '\n')"
# Chave de TESTE pública do Cloudflare Turnstile (sempre aprova): só para o ensaio.
s turnstile_secret "1x0000000000000000000000000000000AA"
for p in s3_api_access_key s3_worker_access_key; do s "$p" "$(openssl rand -hex 10)"; done
for p in s3_api_secret_key s3_worker_secret_key; do s "$p" "$(h)"; done
s smtp_usuario ensaio; s smtp_senha "$(h)"
s vapid_private_key ""; s anthropic_api_key ""
cat > "$DIR/s3.json" <<JSON
{"identities":[
 {"name":"api","credentials":[{"accessKey":"$(cat "$VV_SEGREDOS/s3_api_access_key")","secretKey":"$(cat "$VV_SEGREDOS/s3_api_secret_key")"}],"actions":["Admin"]},
 {"name":"worker","credentials":[{"accessKey":"$(cat "$VV_SEGREDOS/s3_worker_access_key")","secretKey":"$(cat "$VV_SEGREDOS/s3_worker_secret_key")"}],"actions":["Read:vv-docs","Write:vv-docs","List:vv-docs"]}]}
JSON

echo "== Banco, migrations e KEK (como o deploy.sh)"
dc up -d postgres
dc run --rm migracoes up >/dev/null 2>&1
[ "$(dc exec -T postgres psql -U postgres -d vv -Atc 'select count(*) from core.chaves_mestras')" = 0 ]
dc run --rm kek 1
# Produção não tem as chaves de desenvolvimento (cadastro aberto, MFA opcional).
[ -z "$(dc exec -T postgres psql -U postgres -d vv -Atc "select current_setting('vv.mfa', true)")" ]

echo "== Subindo tudo"
# Sem parar aqui: o laço abaixo mostra quem não ficou saudável, com os logs.
dc up -d --remove-orphans >/dev/null 2>&1 || true
for i in $(seq 1 60); do
  ruins="$(dc ps --format '{{.Service}} {{.Health}}' | awk '$1 ~ /^(postgres|api|worker|web|clamav)$/ && $2 != "healthy" {print $1}')"
  [ -z "$ruins" ] && break
  [ "$i" = 60 ] && { echo "não ficou saudável: $ruins" >&2; dc ps -a; dc logs --tail 40 $ruins >&2; exit 1; }
  # Container que morreu não volta sozinho: falha já, com o log.
  mortos="$(dc ps -a --format '{{.Service}} {{.State}}' | awk '$1 ~ /^(api|worker|web)$/ && $2 == "exited" {print $1}')"
  [ -n "$mortos" ] && { echo "parou: $mortos" >&2; dc logs --tail 40 $mortos >&2; exit 1; }
  sleep 10
done
dc ps

echo "== Conferências pela porta pública (TLS da CA interna do Caddy)"
url=https://ensaio.vv.test:18443
R=(--resolve ensaio.vv.test:18443:127.0.0.1)
confere() { # descrição, comando...
  local d="$1"; shift
  if "$@"; then echo "  ok  $d"; else echo "  FALHOU  $d" >&2; exit 1; fi
}
health() { curl -fsSk "${R[@]}" "$url/api/health" >/dev/null; }
cabecalhos() {
  local c; c="$(curl -fsSk "${R[@]}" -D - -o /dev/null "$url/")"
  grep -qi '^strict-transport-security:' <<<"$c" && grep -qi '^content-security-policy:' <<<"$c"
}
login_errado() {
  [ "$(curl -sk "${R[@]}" -o /dev/null -w '%{http_code}' -H 'Origin: https://ensaio.vv.test' -H 'Content-Type: application/json' \
    --data '{"email":"ninguem@exemplo.test","senha":"senha-errada-123","plataforma":"web"}' "$url/api/auth/login")" = 401 ]
}
dotfiles() { [ "$(curl -sk "${R[@]}" -o /dev/null -w '%{http_code}' "$url/.env")" = 404 ]; }
sem_segredo_no_ambiente() {
  local c kek; kek="$(cat "$VV_SEGREDOS/vv_kek")"
  for c in $(dc ps -q); do
    if docker inspect "$c" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -Fq "$kek"; then return 1; fi
  done
}
banco_sem_porta() { [ -z "$(docker port "$(dc ps -q postgres)")" ]; }
so_caddy_publica() { [ "$(docker ps --filter label=com.docker.compose.project=vv-ensaio --format '{{.Ports}}' | grep -c -- '->')" = 1 ]; }
confere "/api/health pelo Caddy com TLS" health
confere "cabeçalhos de segurança (HSTS e CSP)" cabecalhos
confere "login com senha errada recusado (401)" login_errado
confere "dotfiles bloqueados (404)" dotfiles
confere "segredos fora do ambiente dos containers" sem_segredo_no_ambiente
confere "Postgres sem porta publicada" banco_sem_porta
confere "só o Caddy publica porta" so_caddy_publica

echo
if [ "$MANTER" = 1 ]; then echo "Ensaio no ar: $url (no /etc/hosts: 127.0.0.1 ensaio.vv.test; pasta $DIR; derrubar: docker compose -p vv-ensaio down -v)"
else echo "Ensaio OK. Derrubando (volumes do ensaio apagados)."; fi
