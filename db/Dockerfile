# Postgres do VV Licitações (ADR-011): imagem oficial + pgvector (busca, ADR-008).
# pgTAP só entra com --build-arg COM_PGTAP=1 (dev e CI); a imagem de produção fica sem ele.
FROM postgres:17-bookworm

ARG COM_PGTAP=0
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17-pgvector \
 && if [ "$COM_PGTAP" = "1" ]; then apt-get install -y --no-install-recommends postgresql-17-pgtap; fi \
 && rm -rf /var/lib/apt/lists/*

# Papéis e banco na primeira inicialização do volume (senhas vêm do ambiente, nunca do repositório).
COPY init/ /docker-entrypoint-initdb.d/
