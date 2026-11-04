# Backup e restauração (ADR-015, RF-01.16, CA-6)

pgBackRest 2.x no container do Postgres: **WAL contínuo + full semanal + diferencial diário**, tudo **cifrado (aes-256-cbc)**, num **bucket S3 de outro provedor**. Recuperação a qualquer instante (PITR).

| Meta | Valor | Como |
| --- | --- | --- |
| RPO (perda máxima) | minutos | `archive_timeout=60` e arquivamento síncrono: o WAL só é confirmado depois de estar no bucket |
| RTO (tempo para voltar) | a medir no 1º ensaio real | depende do tamanho do banco; o ensaio trimestral registra o tempo |
| Retenção | 5 fulls semanais (~35 dias) + diferenciais **no pgBackRest**; com versionamento/object lock no bucket a retenção real é a do lock/lifecycle | declarar o prazo **total** no inventário LGPD |

## O que está (e o que não está) no backup

- **Está:** todo o banco (schemas `core`, `pub`, `priv`, `ops`, `audit`), com hashes de senha, segredos de TOTP **cifrados** e a auditoria.
- **Não está, e precisa de custódia própria (cofre fora do servidor, duas pessoas):**
  1. **`VV_KEK`** (chave-mestra, ADR-017): sem ela os segredos de TOTP e campos cifrados do backup **não abrem**. **Rotacionar a KEK não torna backups antigos legíveis com a chave nova:** guarde as KEKs antigas enquanto houver backup que dependa delas. Nunca junto do bucket nem do `.env.backup`.
  2. **Senha de cifra do repositório** (`PGBACKREST_REPO1_CIPHER_PASS`): **perder = perder todos os backups.**
  3. Credenciais do bucket e demais `.env` de produção.
  4. Arquivos de documentos (S3 da aplicação, ADR-017): backup próprio, fora deste escopo (Fase 03).

## Instalação em produção

1. **Bucket**: provedor **diferente** do da VPS e do S3 de arquivos. Versionamento e **object lock/retenção mínima** ligados (confirme se o provedor suporta: o ransomware não pode apagar nem sobrescrever os backups). **Região e contrato:** backup fora do Brasil é transferência internacional de dados pessoais (LGPD art. 33); decida isso antes de provisionar.
2. **Duas credenciais** do bucket:
   - **servidor** (no `.env.backup`): ler, listar e **gravar**; **sem `DeleteObject`** (o `pgbackrest.conf` usa `expire-auto=n`). Quem invadir o banco não apaga os backups;
   - **restauração/expiração** (só no cofre, usada em outra máquina): leitura (para restaurar) e, numa conta à parte, a que roda `pgbackrest expire`. Alternativa: lifecycle do bucket (~40 dias).
3. **Segredos** (`.env.backup`, `0400`, fora do repositório):

   ```text
   PGBACKREST_REPO1_CIPHER_PASS=<openssl rand -base64 48; guardada também no cofre>
   PGBACKREST_REPO1_S3_ENDPOINT=...   PGBACKREST_REPO1_S3_REGION=...   PGBACKREST_REPO1_S3_BUCKET=...
   PGBACKREST_REPO1_S3_KEY=...        PGBACKREST_REPO1_S3_KEY_SECRET=...
   ```

   Risco aceito: essas variáveis ficam no ambiente do container do Postgres (visíveis a `docker inspect` e a um superusuário SQL). Mitigação: os papéis da aplicação não são superusuário nem membros de papel nenhum (pgTAP `001_guarda_global`); nunca rode `docker compose config` em log de CI.
4. **Compose** (caminhos absolutos, da raiz do repositório): `docker compose -f /opt/vv/<compose de produção> -f /opt/vv/infra/backup/compose.backup.yml up -d postgres`. O `command:` do override **substitui** o do compose base; copie para ele flags que o base tenha.
5. **Criar o repositório** (uma vez): `... exec -u postgres postgres pgbackrest --stanza=vv stanza-create`, depois `check`; então `infra/backup/rodar-backup.sh full`.
6. **Agendar** (systemd): copiar `infra/backup/systemd/*` para `/etc/systemd/system/`; criar **`/etc/vv/backup-host.env` com `chmod 0600`, dono root**:

   ```text
   COMPOSE_FILE=/opt/vv/<compose de produção>:/opt/vv/infra/backup/compose.backup.yml
   HC_URL_FULL=...   HC_URL_DIFF=...   HC_URL_CHECK=...   HC_URL_VERIFY=...
   ```

   **Uma URL do Healthchecks por operação**, cada uma com período e tolerância próprios (full: 7 dias; diff: 1 dia; check: 1 hora). Assim, full ou diff parados disparam alarme mesmo com o `check` verde. Depois: `systemctl enable --now vv-backup-full.timer vv-backup-diff.timer vv-backup-check.timer`. Um backup que falha ou não roda deixa o alarme tocar.
7. **Monitorar o arquivamento** (bucket fora do ar, credencial revogada ou cota estourada **enchem o disco do `pg_wal`** e derrubam o banco): alerta quando `select failed_count, last_failed_time > last_archived_time from pg_stat_archiver` indicar falha e quando o `pg_wal` passar de 50% do disco. Se o disco encher, não apague WAL à mão: restabeleça o arquivamento (o `check` horário avisa em até 1 h).

## Restaurar

**Antes de tudo:** defina o ponto no tempo; tenha o cofre (senha de cifra, KEK, **credencial de restauração só de leitura**); **pare a API e o worker**; **desligue o servidor antigo e revogue a credencial de escrita dele** se ele ainda estiver vivo (senão continua mandando WAL de outra linha do tempo para o mesmo repositório).

### A. Dado apagado ou alterado por engano (PITR para um banco paralelo)

```bash
docker volume create vv_pgdata_restaurado
docker run --rm -u postgres --env-file <env SÓ de leitura> \
  -v vv_pgdata_restaurado:/var/lib/postgresql/data \
  -v /opt/vv/infra/backup/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
  <imagem vv-postgres> pgbackrest --stanza=vv --type=time \
    --target="2026-11-03 14:30:00-03" --target-timeline=current --target-action=promote restore
```

Suba um Postgres **temporário e isolado** sobre esse volume: **`-c archive_mode=off`**, **sem** o `compose.backup.yml` e **sem** o `.env.backup` de escrita, sem rede externa, porta que não é a de produção. (Um banco restaurado com arquivamento ligado criaria uma linha do tempo nova e enviaria WAL ao repositório de produção.) Extraia o dado (`pg_dump` de tabelas ou linhas), reaplique em produção com cuidado e **apague o volume**.

### B. Servidor perdido ou banco comprometido (restaurar tudo)

1. **Preserve o volume comprometido** para perícia (não apague). Servidor novo com Docker, `.env`/`.env.backup` e a `VV_KEK` do cofre.
2. Volume do Postgres **vazio**; restaurar como em A, sobre o volume de produção: `--type=time --target=<logo antes do incidente> --target-timeline=current --target-action=promote` (ou `--type=default` para o último WAL). Rode a restauração com a credencial de leitura; depois suba o Postgres **já com** o `compose.backup.yml` (credencial de escrita).
3. Subir só o `postgres` (conclui a recuperação sozinho): `select pg_is_in_recovery()` deve dar `f`. Rodar `pgbackrest check` e **fazer um novo full** (`rodar-backup.sh full`): a restauração cria uma nova linha do tempo.
4. **Antes de subir `api` e `worker`**, no banco restaurado (ele voltou ao passado; o que foi revogado depois do ponto, voltou junto):
   - revogar tudo: `update core.sessoes set revogada_em = now() where revogada_em is null;`
   - invalidar credenciais pendentes: `update core.tokens_recuperacao set usado_em = now() where usado_em is null;` `update core.step_up_tokens set usado_em = now() where usado_em is null;` `update core.codigos_recuperacao set usado_em = now() where usado_em is null;` (cada pessoa gera códigos novos depois de entrar com o autenticador) e `update core.convites set revogado_em = now() where aceito_em is null and revogado_em is null;`
   - `update core.dispositivos_push set revogado_em = now() where revogado_em is null;` (push religado só por quem entrar de novo);
   - **cancelar a fila**: `update ops.jobs set status = 'falhou', ultimo_erro = 'cancelado na restauração' where status in ('pendente','executando');` (senão o worker repete e-mails e pushes);
   - **reaplicar o que a restauração desfez**: pessoas desativadas/rebaixadas, senhas/MFA trocados, empresas arquivadas e **exclusões definitivas** feitos depois do ponto. A auditoria do banco perde esse trecho: use uma fonte **fora do banco** (logs da API, registro de exclusões, atas) e reconstitua.
5. **Conferir antes de abrir ao público:** `dbmate status` (migrations batem com o `main`); contagens das tabelas principais; `select max(occurred_at) from audit.audit_log` (até onde o log vai); `core.chaves_mestras` + `db/scripts/registrar-kek.sh` confirmam que a `VV_KEK` do cofre é a do banco.
6. Se o motivo foi **invasão**: redefinir senhas de quem tem acesso, rotacionar `VV_KEK` (mantendo a antiga no cofre) e os demais segredos, e seguir o runbook de incidente.
7. Subir `api` e `worker`; registrar o incidente e o tempo total (RTO real) em `docs/phase-reports/evidencias/`.

## Ensaio de restauração (trimestral, ADR-015)

1. **Automático (todo PR, CI):** `infra/backup/testar-restauracao.sh` num cluster descartável: full + diferencial + WAL; **prova a cifra com controles** (o mesmo marcador aparece em claro no banco e num repositório SEM cifra, e não aparece em nenhum dos arquivos do repositório cifrado, todos com cabeçalho `Salted__`); simula o desastre; confirma que a senha errada falha **por decifragem**; restaura com PITR e confere que tudo até o alvo voltou e o que veio depois não. O script remove variáveis `PGBACKREST_*` do ambiente (nunca toca o bucket real). Evidência: `docs/phase-reports/evidencias/fase-01/`.
2. **Real (a cada trimestre, numa VM descartável):** cenário B com o bucket de verdade, a credencial de leitura e a `VV_KEK` do cofre; cronometrar, conferir as contagens e registrar (data, ponto restaurado, tempo, quem fez, problemas). Primeiro ensaio real: **pendente** (VPS e bucket de produção).

## O que o teste automático NÃO cobre

- O transporte **S3** (usa repositório em disco): cobrir com MinIO no compose/CI quando houver Docker.
- O container (imagem `db/Dockerfile`, volumes, `archive_command` via `command:`): o CI só constrói a imagem e confere `pgbackrest version`. O CI testa com o pgBackRest do Ubuntu e Postgres 16; produção usa o do PGDG e Postgres 17: rode o teste dentro da imagem `vv-db` assim que o CI tiver essa etapa.
- Tempo de restauração com o volume real (RTO); falha de bucket, credencial sem permissão e cota estourada (para isso existem o `check` horário e o monitor do arquivador).
- Reversão do repositório a um estado antigo válido (a cifra CBC não autentica): defesa é versionamento + object lock.

## Operação do dia a dia

- `infra/backup/rodar-backup.sh check` (WAL chegando), `... verify` (integridade do repositório).
- `docker compose exec -u postgres postgres pgbackrest --stanza=vv info` mostra backups e o intervalo de WAL (de onde até onde dá para PITR).
- Rotação da senha de cifra: criar um repositório novo (`repo2`) com a senha nova, fazer full, só então aposentar o antigo.
