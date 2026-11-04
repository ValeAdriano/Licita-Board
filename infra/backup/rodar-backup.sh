#!/usr/bin/env bash
# Roda uma operação do pgBackRest no container do Postgres e avisa o Healthchecks.io (ADR-015).
# Uso: rodar-backup.sh full|diff|incr|check|verify
# Ambiente (arquivo 0600 de root, /etc/vv/backup-host.env; ver README.md):
#   COMPOSE_FILE / VV_COMPOSE  qual compose usar (padrão "docker compose"; em produção o de produção
#                              + infra/backup/compose.backup.yml, com caminhos ABSOLUTOS)
#   HC_URL_FULL, HC_URL_DIFF, HC_URL_CHECK, HC_URL_VERIFY   uma URL do Healthchecks POR operação,
#                              cada uma com o período e a tolerância dela; sem a URL, sem aviso.
# O Healthchecks recebe só start/ok/fail: nenhum dado do banco ou do backup sai daqui. A URL é uma
# capability (quem a conhece silencia o alarme): vai por stdin para o curl, nunca no argv/`ps`.
set -euo pipefail
operacao="${1:?uso: rodar-backup.sh full|diff|incr|check|verify}"
compose="${VV_COMPOSE:-docker compose}"
var_url="HC_URL_$(printf '%s' "$operacao" | tr '[:lower:]' '[:upper:]')"
url="${!var_url:-}"

hc() { # $1 = sufixo (/start, /fail ou vazio)
  [ -n "$url" ] || return 0
  printf 'url = "%s%s"\n' "$url" "${1:-}" | curl -fsS -m 10 --retry 3 -o /dev/null -K - || true
}

case "$operacao" in
  full | diff | incr) args=(--type="$operacao" backup) ;;
  check | verify) args=("$operacao") ;;
  *) echo "operação inválida: $operacao" >&2; exit 2 ;;
esac

pgbackrest() { $compose exec -T -u postgres postgres pgbackrest --stanza=vv "$@"; }

hc /start
if ! pgbackrest "${args[@]}"; then
  hc /fail
  echo "backup ($operacao) FALHOU" >&2
  exit 1
fi
# Depois de um full, confere o repositório (arquivos legíveis e checksums); falha também avisa.
if [ "$operacao" = "full" ] && ! pgbackrest verify; then
  hc /fail
  echo "verify depois do full FALHOU" >&2
  exit 1
fi
hc ""
