# Postgres do VV Licitações (ADR-011): imagem oficial + pgvector (busca, ADR-008) + pgBackRest (backup
# e PITR, ADR-015; configuração em infra/backup).
# pgTAP só entra com --build-arg COM_PGTAP=1 (dev e CI); a imagem de produção fica sem ele.
FROM postgres:17-bookworm

ARG COM_PGTAP=0
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17-pgvector pgbackrest \
 && if [ "$COM_PGTAP" = "1" ]; then apt-get install -y --no-install-recommends postgresql-17-pgtap; fi \
 && rm -rf /var/lib/apt/lists/*

# Diretórios do pgBackRest (a configuração entra por volume: infra/backup/compose.backup.yml).
# /etc/pgbackrest fica de root: o usuário postgres só LÊ a configuração (não a altera nem inclui conf.d).
RUN mkdir -p /var/spool/pgbackrest /var/log/pgbackrest /etc/pgbackrest \
 && chown -R postgres:postgres /var/spool/pgbackrest /var/log/pgbackrest \
 && chown root:root /etc/pgbackrest && chmod 0755 /etc/pgbackrest

# Papéis e banco na primeira inicialização do volume (senhas vêm do ambiente, nunca do repositório).
COPY init/ /docker-entrypoint-initdb.d/
