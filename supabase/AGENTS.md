# supabase · regras locais

Complementa o `AGENTS.md` da raiz. **Esta é a parte que não perdoa erro**: toda migration passa pelo subagente/prompt `revisor-migration` e por revisão humana linha a linha.

## Schemas (ADR-003)

| Schema | Conteúdo | Quem escreve | RLS |
| --- | --- | --- | --- |
| `core` | empresas, usuários, vínculos, permissões, notificações | app (admin) | por vínculo/permissão |
| `pub` | órgãos, editais, itens, arquivos, feriados, base jurídica | worker | leitura para `authenticated`, escrita só service role |
| `priv` | tudo que é da empresa: produtos, documentos, agenda, análises, preços, peças | usuários com permissão | `core.has_permission(empresa_id, modulo, acao)` |
| `ops` | fontes, execuções, jobs, métricas | worker | só SUPERADMIN lê |
| `audit` | `audit_log` insert-only | triggers | sem UPDATE/DELETE para ninguém |

## Regras de migration

1. Criar com `npx supabase migration new <nome_em_snake_case>`. Um assunto por migration.
2. Migration no `main` é **imutável**. Corrigiu? Nova migration.
3. Toda tabela: `alter table ... enable row level security;` na mesma migration. O teste `000_rls_ligado` falha se esquecer.
4. Tabela privada: `empresa_id uuid not null references core.empresas(id)`, índice em `empresa_id`, colunas padrão (`id uuid default extensions.uuid_generate_v7()` ou equivalente definido na Fase 01, `created_at`, `updated_at`, `created_by`, `deleted_at`), triggers de `updated_at` e auditoria.
5. Policies separadas por operação (`select`, `insert`, `update`, `delete`), todas via `core.has_permission`. `insert`/`update` com `with check` igual ao `using`. Nunca `using (true)` em `priv`.
6. Grants explícitos: o projeto usa `auto_expose_new_tables = false`.
7. Funções `security definer` com `set search_path = ''` e nomes qualificados.
8. Dinheiro `numeric(18,4)`; instantes `timestamptz`; datas de prazo `date` + fuso do órgão quando necessário.
9. Terminar com bloco `-- down:` comentado, descrevendo o rollback.
10. Nada de dados reais em `seed.sql`.

## Testes (pgTAP)

- `tests/000_rls_ligado.test.sql`: guarda global (toda tabela com RLS, nenhuma policy de `anon` em `priv`/`audit`).
- `tests/isolamento/<schema>_<tabela>.test.sql`: obrigatório para cada tabela de `priv` (o CI confere com `scripts/check_isolation_coverage.py`). Base: `tests/isolamento/_modelo.sql.example`.
- Rodar: `npx supabase test db` (Docker necessário).

## Remoto

Agentes **não** aplicam nada em projeto remoto (`db push`, `apply_migration`, `execute_sql` de escrita). Deploy de banco é passo do pipeline aprovado pelo Adriano.
