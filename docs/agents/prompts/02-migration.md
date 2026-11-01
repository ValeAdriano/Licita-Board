# Prompt · 02 Migration + RLS + isolamento

> Cole em qualquer agente. Troque `<...>`. Pré-requisito: spec da fase com status `Aprovada`.

Implemente a parte de banco **"<grupo de tabelas>"** da spec `docs/specs/fase-<XX>.md`.

**Leia antes:** `AGENTS.md`, `supabase/AGENTS.md`, `docs/adr/ADR-003-multi-tenant-rls.md`, `docs/agents/checklists/revisao-migration.md`, migrations existentes em `supabase/migrations/`.

**Faça:**
1. `npx supabase migration new <nome>` (se não tiver CLI, crie `supabase/migrations/<AAAAMMDDHHMMSS>_<nome>.sql`).
2. Tabelas exatamente como na spec. Divergência necessária? Pare e pergunte.
3. Na mesma migration: RLS ligado, policies por operação via `core.has_permission`, grants mínimos, índices, triggers de `updated_at` e auditoria, bloco `-- down:` comentado.
4. Para cada tabela de `priv`: `supabase/tests/isolamento/<schema>_<tabela>.test.sql` cobrindo SELECT/INSERT/UPDATE/DELETE cruzados (base: `_modelo.sql.example`). Para `pub`: teste de que `authenticated` lê e não escreve.
5. Testes de regra do banco (constraints, CNPJ, funções) em `supabase/tests/`.
6. Rode, se tiver Docker: `npx supabase db reset && npx supabase test db`. Rode sempre: `python3 scripts/check_isolation_coverage.py`.
7. Faça a auto-revisão com `docs/agents/checklists/revisao-migration.md` item a item (ou subagente `revisor-migration` no Claude Code).

**Não faça:** editar migration existente; aplicar em projeto remoto; `using (true)`; policy para `anon` em `priv`; tocar `audit` sem ser pedido.

**Entregue:** PR com a lista das tabelas, o resultado real dos testes e os pontos que pedem atenção humana especial.
