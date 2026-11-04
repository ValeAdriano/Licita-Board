#!/usr/bin/env bash
# Prova a restauração do backup de ponta a ponta, num cluster descartável (nada do projeto é tocado):
#   1. sobe um Postgres com archive_command do pgBackRest, repositório CIFRADO (aes-256-cbc);
#   2. grava dados em fases (antes do full, depois do full, até o alvo, depois do alvo);
#   3. faz backup full + diferencial e arquiva o WAL;
#   4. prova que o repositório não contém o texto dos dados (cifra);
#   5. simula o desastre (apaga o diretório de dados);
#   6. confirma que a senha errada NÃO restaura;
#   7. restaura com PITR até o instante "alvo" e confere: tudo até o alvo voltou, o que veio depois não.
# Uso: infra/backup/testar-restauracao.sh      (PGBIN aponta para os binários do Postgres, se preciso)
# O transporte S3 não é exercitado aqui (repo posix): ver README.md, seção "O que este teste não cobre".
set -euo pipefail

# Segurança do teste: variáveis PGBACKREST_* do ambiente (ex.: `source .env.backup` do servidor) têm
# precedência sobre o arquivo de configuração e fariam o teste escrever no bucket REAL.
while IFS= read -r v; do unset "$v"; done < <(env | grep -o '^PGBACKREST_[A-Za-z0-9_]*' || true)

PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl)")}"
PGBACKREST="$(command -v pgbackrest)"
PORTA="${PGPORT_TESTE:-55432}"
RAIZ="$(mktemp -d /tmp/vvb.XXXXXX)"   # curto: o caminho do socket unix tem limite de tamanho
DADOS="$RAIZ/dados"; REPO="$RAIZ/repo"; CONF="$RAIZ/pgbackrest.conf"
REPO_CLARO="$RAIZ/repo-claro"; CONF_CLARO="$RAIZ/pgbackrest-claro.conf"
SENHA_CIFRA="$(openssl rand -hex 32)"
MARCADOR="SEGREDO-NO-BANCO-$(openssl rand -hex 8)"
# locale C em tudo: o teste não depende dos idiomas instalados (CI e notebook diferem).
export LC_ALL=C
export PGHOST="$RAIZ" PGPORT="$PORTA" PGUSER=postgres PGDATABASE=postgres
export PGBACKREST_REPO1_CIPHER_PASS="$SENHA_CIFRA"

limpar() {
  [ -n "${VV_DEBUG:-}" ] && tail -20 "$RAIZ"/pg*.log 2>/dev/null || true
  "$PGBIN/pg_ctl" -D "$DADOS" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$RAIZ"
}
trap limpar EXIT INT TERM

passo() { printf '\n== %s\n' "$*"; }
falha() { printf 'FALHOU: %s\n' "$*" >&2; exit 1; }
sql() { "$PGBIN/psql" -X -qAt -v ON_ERROR_STOP=1 "$@"; }
br() { "$PGBACKREST" --config="$CONF" --stanza=vv "$@"; }
br_claro() { "$PGBACKREST" --config="$CONF_CLARO" --stanza=vv "$@"; }
contagem() { sql -c "select fase || '=' || count(*) from registros group by fase order by fase" | paste -sd, -; }

cat > "$CONF" <<CFG
[global]
repo1-path=$REPO
repo1-cipher-type=aes-256-cbc
repo1-retention-full=2
log-path=$RAIZ/log
lock-path=$RAIZ/lock
spool-path=$RAIZ/spool
log-level-console=warn
log-level-file=info
# Sem compressão de propósito: com zst o texto some mesmo sem cifra e o teste de cifra não provaria nada.
compress-type=none
start-fast=y

[vv]
pg1-path=$DADOS
pg1-port=$PORTA
pg1-socket-path=$RAIZ
pg1-user=postgres
CFG
# Repositório de CONTROLE: mesmas opções, mas SEM cifra. O marcador tem que aparecer nele.
sed -e "s|^repo1-path=.*|repo1-path=$REPO_CLARO|" -e '/^repo1-cipher-type=/d' "$CONF" > "$CONF_CLARO"
mkdir -p "$RAIZ/log" "$RAIZ/lock" "$RAIZ/spool"

passo "1. Postgres descartável com arquivamento de WAL pelo pgBackRest"
"$PGBIN/initdb" -D "$DADOS" -U postgres --auth=trust --data-checksums --locale=C --encoding=UTF8 >/dev/null
cat >> "$DADOS/postgresql.conf" <<CFG
port = $PORTA
listen_addresses = ''
unix_socket_directories = '$RAIZ'
wal_level = replica
archive_mode = on
archive_command = '$PGBACKREST --config=$CONF --stanza=vv archive-push %p'
archive_timeout = 60
CFG
"$PGBIN/pg_ctl" -D "$DADOS" -l "$RAIZ/pg.log" -w start >/dev/null
br stanza-create
br check

passo "2. Dados em fases + backup full e diferencial"
sql -c "create table registros (id serial primary key, fase text not null, texto text not null)"
sql -c "insert into registros (fase, texto) select 'a-antes-do-full', '$MARCADOR' || g from generate_series(1, 2000) g"
br --type=full backup
sql -c "insert into registros (fase, texto) select 'b-depois-do-full', 'x' || g from generate_series(1, 300) g"
br --type=diff backup
sql -c "insert into registros (fase, texto) select 'c-ate-o-alvo', 'y' || g from generate_series(1, 150) g"
sql -c "select pg_switch_wal()" >/dev/null
sleep 2
ALVO="$(sql -c "select clock_timestamp()::text")"
sleep 2
sql -c "insert into registros (fase, texto) select 'd-depois-do-alvo', 'z' || g from generate_series(1, 50) g"
sql -c "select pg_switch_wal()" >/dev/null
sleep 2
ANTES="$(contagem)"
echo "antes do desastre: $ANTES (alvo do PITR: $ALVO)"
[ "$ANTES" = "a-antes-do-full=2000,b-depois-do-full=300,c-ate-o-alvo=150,d-depois-do-alvo=50" ] || falha "estado inicial inesperado"
br check

passo "3. O repositório está cifrado (prova com controle, não só um grep)"
"$PGBIN/pg_ctl" -D "$DADOS" -w -m fast restart >/dev/null
sql -c "checkpoint" >/dev/null
grep -rqa "$MARCADOR" "$DADOS" || falha "controle 1: o marcador deveria existir em claro no diretório de dados"
# Controle 2: o MESMO backup num repositório sem cifra (mesma compressão) deixa o marcador visível,
# então o grep abaixo acusaria um repositório em claro.
br_claro stanza-create >/dev/null
br_claro --no-archive-check --type=full backup >/dev/null
grep -rqa "$MARCADOR" "$REPO_CLARO" || falha "controle 2: o marcador deveria aparecer no repositório SEM cifra"
echo "ok (controles): o marcador aparece em claro no banco e no repositório sem cifra"
if grep -rqa "$MARCADOR" "$REPO"; then falha "texto em claro no repositório de backup cifrado"; fi
# Todo arquivo do repositório cifrado tem o cabeçalho do OpenSSL ("Salted__").
sem_cabecalho=0
while IFS= read -r arq; do
  [ "$(head -c 8 "$arq")" = "Salted__" ] || { echo "sem cabeçalho de cifra: ${arq#"$REPO"/}"; sem_cabecalho=$((sem_cabecalho + 1)); }
done < <(find "$REPO" -type f)
[ "$sem_cabecalho" -eq 0 ] || falha "$sem_cabecalho arquivo(s) do repositório sem cifra"
echo "ok: $(find "$REPO" -type f | wc -l | tr -d ' ') arquivos, nenhum em claro, todos com cabeçalho de cifra"

passo "4. Desastre: o servidor cai e o diretório de dados é apagado"
"$PGBIN/pg_ctl" -D "$DADOS" -m immediate stop >/dev/null
rm -rf "$DADOS"
mkdir -p "$DADOS" && chmod 700 "$DADOS"

passo "5. Senha de cifra errada NÃO restaura"
if PGBACKREST_REPO1_CIPHER_PASS="senha-errada" br restore > "$RAIZ/errada.log" 2>&1; then
  falha "restaurou com a senha errada"
fi
# Tem que falhar PELO MOTIVO certo: com a senha errada o pgBackRest decifra lixo e não consegue ler o
# backup.info ("FormatError"/"unable to load info file"); não pode ser erro de configuração ou de caminho.
# A mesma operação com a senha certa funciona (passo 6) e o `br info` com a certa já funcionou acima.
if ! grep -qE "FormatError|unable to load info file|decrypt|cipher" "$RAIZ/errada.log"; then
  tr -cd '[:print:]\n' < "$RAIZ/errada.log" | head -5 >&2
  falha "a restauração falhou, mas não por causa da senha de cifra"
fi
if grep -q "no backup set found" "$RAIZ/errada.log" && ! grep -qE "FormatError|unable to load info file" "$RAIZ/errada.log"; then
  falha "falhou por ausência de backup, não por senha"
fi
echo "ok: restauração recusada por falha de decifragem"
rm -rf "$DADOS" && mkdir -p "$DADOS" && chmod 700 "$DADOS"

passo "6. Restauração com PITR até o alvo"
br --type=time --target="$ALVO" --target-action=promote restore
"$PGBIN/pg_ctl" -D "$DADOS" -l "$RAIZ/pg2.log" -w start >/dev/null
for _ in $(seq 1 30); do
  [ "$(sql -c "select pg_is_in_recovery()")" = "f" ] && break
  sleep 1
done
DEPOIS="$(contagem)"
echo "depois da restauração: $DEPOIS"
[ "$(sql -c "select pg_is_in_recovery()")" = "f" ] || falha "o servidor não saiu da recuperação"
[ "$DEPOIS" = "a-antes-do-full=2000,b-depois-do-full=300,c-ate-o-alvo=150" ] \
  || falha "PITR errado: esperado tudo até o alvo e nada depois (recebido: $DEPOIS)"
echo "ok: tudo até o alvo voltou e o que veio depois não"

passo "7. Integridade do repositório e resumo"
"$PGBIN/pg_ctl" -D "$DADOS" -m fast stop >/dev/null
br verify >/dev/null && echo "ok: pgbackrest verify"
br info | sed -n 1,12p
printf '\nversões: %s · %s\n' "$("$PGBACKREST" version)" "$("$PGBIN/postgres" --version)"
printf '\nRESTAURAÇÃO PROVADA: full + diferencial + WAL, cifrado (provado com controle), PITR até o alvo.\n'
