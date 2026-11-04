# Prompt · 02 Migration + RLS + isolamento

> Cole em qualquer agente. Troque `<...>`. Pré-requisito: spec da fase com status `Aprovada`.

Implemente a parte de banco **"<grupo de tabelas>"** da spec `docs/specs/fase-<XX>.md`.

**Leia antes:** `AGENTS.md`, `db/AGENTS.md`, `docs/adr/ADR-003-multi-tenant-rls.md`, `docs/agents/checklists/revisao-migration.md`, migrations existentes em `db/migrations/`.

**Faça:**
1. `docker compose run --rm dbmate new <nome>` (sem Docker, crie `db/migrations/<AAAAMMDDHHMMSS>_<nome>.sql` com `-- migrate:up` e `-- migrate:down`).
2. Tabelas exatamente como na spec. Divergência necessária? Pare e pergunte.
3. Na mesma migration: RLS ligado, policies por operação via `core.has_permission`, grants mínimos, índices, triggers de `updated_at` e auditoria, bloco `-- migrate:down` executável (o CI roda up, rollback e up).
4. Para cada tabela de `priv`: `db/tests/isolamento/<schema>_<tabela>.test.sql` cobrindo SELECT/INSERT/UPDATE/DELETE cruzados (base: `_modelo.sql.example`). Para `pub`: teste de que `vv_api` lê e não escreve.
5. Testes de regra do banco (constraints, CNPJ, funções) em `db/tests/`.
6. Rode `db/scripts/test-local.sh` (Postgres do compose ou local com pgTAP; aplica as migrations com up, rollback e up e roda o pgTAP) e `python3 scripts/check_isolation_coverage.py`.
7. Revisão (`revisao-migration.md`, subagente `revisor-migration`) só se o Adriano pedir (modo rápido).

**Não faça:** editar migration existente; aplicar em projeto remoto; `using (true)`; policy para `anon` em `priv`; tocar `audit` sem ser pedido.

**Entregue:** commit(s) direto no `main`, com uma frase sobre o que ficou sem teste ou pela metade (modo rápido, AGENTS.md §0).
