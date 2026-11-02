# Checklist · Revisão de migration

Para o agente (auto-revisão) e para o Adriano (revisão linha a linha).

## Estrutura

- [ ] Arquivo novo; nenhuma migration do `main` alterada.
- [ ] Um assunto; nome descritivo em snake_case.
- [ ] Bloco `-- down:` coerente ao final.
- [ ] Objetos com nome qualificado por schema (`core.`, `priv.`...).

## Tabelas

- [ ] `enable row level security` em toda tabela criada.
- [ ] Privada: `empresa_id uuid not null references core.empresas(id)` + índice.
- [ ] Colunas padrão: `id` uuid v7, `created_at`, `updated_at`, `created_by`, `deleted_at`.
- [ ] Dinheiro `numeric(18,4)`; instantes `timestamptz`; enums como `text` + `check` ou tipo enum documentado.
- [ ] Constraints de domínio (CNPJ válido, datas coerentes, valores ≥ 0) no banco, não só no front.
- [ ] Unicidade que evita duplicatas (ex.: chave composta de item PNCP).

## Policies

- [ ] Uma policy por operação; `to authenticated`.
- [ ] `priv`: `core.has_permission(empresa_id, '<modulo>', '<acao>')` com a ação certa da matriz (visualizar/cadastrar/editar/arquivar...).
- [ ] `with check` em INSERT/UPDATE impedindo trocar `empresa_id`.
- [ ] Sem `using (true)` em `priv`; sem policy para `anon`.
- [ ] `pub`: SELECT para `authenticated`; sem INSERT/UPDATE/DELETE para `authenticated`.
- [ ] Soft delete respeitado (`deleted_at is null` onde fizer sentido).
- [ ] Coluna sensível (custo, margem) só via view com permissão "Ver custos e margens".

## Funções e triggers

- [ ] `security definer` só quando necessário, com `set search_path = ''`.
- [ ] Função `stable`/`immutable` marcada corretamente.
- [ ] Triggers de `updated_at` e `audit` ligados.
- [ ] Colunas com dado pessoal (e-mail, CPF, telefone, nome de pessoa) listadas no 2º argumento de `audit.registrar(...)` para serem redigidas; nenhum dado pessoal em `usado_para_alvo` de step-up.
- [ ] Sem SQL dinâmico com concatenação de entrada do usuário.

## Grants

- [ ] Grants explícitos e mínimos (`auto_expose_new_tables = false`).
- [ ] `audit`: só INSERT via trigger; `revoke update, delete` de `authenticated`.

## Testes

- [ ] Isolamento A x B por tabela de `priv` (SELECT/INSERT/UPDATE/DELETE + mover empresa).
- [ ] Positivo e negativo por ação de permissão.
- [ ] Constraints testadas (ex.: CNPJ inválido rejeitado).
- [ ] `001_rls_ligado` continua verde.
