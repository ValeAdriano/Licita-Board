# db · regras locais

Banco da stack nova (ADR-011, ADR-013). Complementa o `AGENTS.md` da raiz. **Esta é a parte que não perdoa erro**: toda migration passa pelo subagente `revisor-migration` e pela revisão humana linha a linha. As regras de modelagem de `supabase/AGENTS.md` (colunas padrão, policies por operação via `core.has_permission`, dinheiro em `numeric(18,4)`, seed fictício) continuam valendo aqui; o que muda está abaixo.

- **Migrations com dbmate:** `docker compose run --rm dbmate new <nome_em_snake_case>`. Cada arquivo tem `-- migrate:up` e `-- migrate:down` **executável** (o CI roda up, rollback e up). Um assunto por migration. Migration no `main` é imutável.
- **Papéis:** migrations rodam como `vv_owner`; a API usa `vv_api` (sem BYPASSRLS); o worker usa `vv_worker`. Grants sempre explícitos, nunca para PUBLIC. Nada de `TRUNCATE`/`TRIGGER`/`REFERENCES` para os papéis da aplicação.
- **Contexto:** policies e funções leem o usuário só por `core.usuario_atual()`, `core.sessao_atual()` e `core.aal_atual()`, e o IP/user-agent da requisição só por `core.ip_atual()`/`core.user_agent_atual()` (gravados por `core.definir_requisicao`). Nunca `current_setting('app.…')` direto.
- **Grants por coluna** em tabela com segredo ou coluna futura sensível (ex.: `core.usuarios`): grant por tabela vale para colunas criadas depois.
- **Views:** sempre `with (security_invoker = true)`. Materialized view e foreign table não recebem grant dos papéis da aplicação.
- **Funções `security definer`:** `set search_path = ''` e nomes qualificados.
- **Extensões:** só no `db/init` (superusuário), no schema `extensions`. Migration não cria extensão.
- **Testes:** `db/tests/*.test.sql` (pgTAP no schema `tap`), isolamento A x B em `db/tests/isolamento/priv_<tabela>.test.sql`. Rodar: `db/scripts/test-local.sh` (Postgres do compose, do CI ou local com pgTAP).
