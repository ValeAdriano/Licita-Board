# ADR-013 · Multi-tenant em duas camadas: guard NestJS + RLS por contexto de transação

- **Status:** Proposto
- **Data:** 2026-11-02
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 1.2, 1.3, 1.4 (Autorização e isolamento), "Separação de dados"
- **Substitui:** ADR-003 (mantém schemas, `has_permission()` e o teste A x B)

## Contexto

Isolamento entre empresas é o requisito que, se falhar, derruba todo o resto (ameaça T1). O Prompt pede duas camadas: verificação no backend em todo endpoint **e** RLS no Postgres. Sem o Supabase, não existe `auth.uid()` vindo de um JWT: a API precisa informar ao banco quem é o usuário.

## Alternativas

| Alternativa | Prós | Contras |
| --- | --- | --- |
| A. **Guard na API + RLS lendo `app.*` definido por transação (`set_config(..., true)`)** | Duas camadas reais; o contexto morre com a transação; reaproveita as policies da Fase 01 | Toda consulta de usuário precisa passar pelo helper de contexto |
| B. Só checagem na API (sem RLS) | Simples | Uma camada só; um `where` esquecido vaza dados |
| C. Um papel de banco por usuário | RLS por `current_user` | Gestão de papéis inviável; pool de conexões quebra |
| D. Schema ou banco por empresa | Isolamento físico | Migrations multiplicadas; dados públicos duplicados |

## Decisão

**A.**

- **Schemas:** `core`, `pub`, `priv`, `ops`, `audit` (como na ADR-003).
- **Papéis:** `vv_owner` (dono dos objetos, só migrations), `vv_api` (login da API, **sem** BYPASSRLS, só grants explícitos), `vv_worker` (login do worker, BYPASSRLS, equivalente à antiga service role). Nenhum papel da aplicação é superusuário.
- **Contexto:** a API executa toda consulta de usuário dentro de `comContexto(sessao, tx => ...)`, que abre a transação e roda `set_config('app.usuario_id' | 'app.sessao_id' | 'app.aal', ..., true)`. `core.usuario_atual()` e `core.aal_atual()` leem esses valores. Fora de uma transação com contexto, o usuário é nulo e as policies negam tudo.
- **Camada 1 (API):** todo controller usa `SessaoGuard` e `@Permissao(modulo, acao)`, e o recurso é sempre buscado por `(id, empresa_id)`. Um teste varre as rotas registradas e falha se alguma não declarar permissão (exceções explícitas: login, recuperação, health).
- **Camada 2 (banco):** toda policy de `priv` chama `core.has_permission(empresa_id, modulo, acao)`; perfis internos exigem `aal2`.
- **Worker:** usa `vv_worker`; todo job valida no banco que o recurso pertence à `empresa_id` do job antes de agir.
- **Testes:** A x B em pgTAP para cada tabela de `priv` (`scripts/check_isolation_coverage.py`) **e** e2e na API para cada endpoint (403/404), mais o teste de que uma conexão devolvida ao pool não carrega contexto.

## Consequências

- **Positivas:** as duas camadas do Prompt existem de verdade; um erro numa delas não vaza dados sozinho.
- **Negativas / risco residual:** esquecer o `comContexto` faz a consulta voltar vazia (falha fechada, não vazamento). Uma regra do Semgrep proíbe o uso do Kysely "cru" fora do módulo de banco.
- **Desvio do Prompt Mestre:** nenhum.
- **Gatilho para reavaliar:** p95 de consulta > 500 ms por causa de RLS, ou cliente que exija isolamento físico por contrato.
