# db · regras locais

Banco do VV Licitações (ADR-011, ADR-013). Complementa o `AGENTS.md` da raiz. **Esta é a parte que não perdoa erro**: toda migration passa pelo subagente `revisor-migration` e pela revisão humana linha a linha.

## Schemas (ADR-003)

| Schema | Conteúdo | Quem escreve | RLS |
| --- | --- | --- | --- |
| `core` | empresas, usuários, sessões, vínculos, permissões, notificações, convites | API (`vv_api`) por função ou policy | por vínculo/permissão |
| `pub` | órgãos, editais, itens, arquivos, feriados, base jurídica | worker (`vv_worker`) | leitura para `vv_api`, escrita só do worker |
| `priv` | tudo que é da empresa: produtos, documentos, agenda, análises, preços, peças | usuários com permissão | `core.has_permission(empresa_id, modulo, acao)` |
| `ops` | fontes, execuções, jobs, métricas | worker | só SUPERADMIN lê |
| `audit` | `audit_log` insert-only | triggers | sem UPDATE/DELETE para ninguém |

## Regras de modelagem

1. Um assunto por migration; migration no `main` é **imutável** (corrigiu? nova migration).
2. Toda tabela: `alter table ... enable row level security;` na mesma migration. O teste `001_guarda_global` falha se esquecer.
3. Tabela privada: `empresa_id uuid not null references core.empresas(id)`, índice em `empresa_id`, colunas padrão (`id uuid default core.uuid_v7()`, `created_at`, `updated_at`, `created_by`, `deleted_at`), triggers de `updated_at` e auditoria.
4. Policies separadas por operação (`select`, `insert`, `update`, `delete`), todas via `core.has_permission`. `insert`/`update` com `with check` igual ao `using`. Nunca `using (true)` em `priv`.
5. Dinheiro `numeric(18,4)`; instantes `timestamptz`; datas de prazo `date` + fuso do órgão quando necessário.
6. Comentário no topo da migration explicando o porquê; `seed` só com dados fictícios.
7. Agentes **não** aplicam nada em banco de produção nem em projeto remoto; deploy de banco é passo do pipeline aprovado pelo Adriano.

## Como trabalhar aqui

- **Migrations com dbmate:** `docker compose run --rm dbmate new <nome_em_snake_case>`. Cada arquivo tem `-- migrate:up` e `-- migrate:down` **executável** (o CI roda up, rollback e up).
- **Papéis:** migrations rodam como `vv_owner`; a API usa `vv_api` (sem BYPASSRLS); o worker usa `vv_worker`. Grants sempre explícitos, nunca para PUBLIC. Nada de `TRUNCATE`/`TRIGGER`/`REFERENCES` para os papéis da aplicação.
- **Contexto:** policies e funções leem o usuário só por `core.usuario_atual()`, `core.sessao_atual()` e `core.aal_atual()`, e o IP/user-agent da requisição só por `core.ip_atual()`/`core.user_agent_atual()` (gravados por `core.definir_requisicao`). Nunca `current_setting('app.…')` direto.
- **Grants por coluna** em tabela com segredo ou coluna futura sensível (ex.: `core.usuarios`): grant por tabela vale para colunas criadas depois.
- **Views:** sempre `with (security_invoker = true)`. Materialized view e foreign table não recebem grant dos papéis da aplicação.
- **Funções `security definer`:** `set search_path = ''` e nomes qualificados.
- **Extensões:** só no `db/init` (superusuário), no schema `extensions`. Migration não cria extensão.
- **Testes:** `db/tests/*.test.sql` (pgTAP no schema `tap`); `000_helpers.test.sql` instala o schema `tests` (empresas A/B, `tests.autenticar_como(usuario, aal)`, `tests.sair()`): use esses helpers em todo teste novo. Isolamento A x B obrigatório por tabela de `priv` em `db/tests/isolamento/priv_<tabela>.test.sql` (o CI confere com `scripts/check_isolation_coverage.py`; base: `db/tests/isolamento/_modelo.sql.example`). Rodar: `db/scripts/test-local.sh` (Postgres do compose, do CI ou local com pgTAP).
