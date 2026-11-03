# ADR-003 · Multi-tenant: `empresa_id` + RLS + `core.has_permission()`

- **Status:** Substituído por ADR-013 (2026-11-02, troca de stack)
- **Data:** 2026-11-01
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 1.2, 1.3, 1.4 (Autorização e isolamento), "Separação de dados"

## Contexto

Isolamento entre empresas é o requisito que, se falhar, derruba todo o resto. Clientes podem ser concorrentes entre si (ameaça T1).

## Alternativas

| Alternativa | Prós | Contras |
| --- | --- | --- |
| A. **Banco único, `empresa_id` + RLS com função única** | Simples, testável, barato | Erro numa policy vaza dados → mitigado por função única + testes A x B obrigatórios |
| B. Schema por empresa | Isolamento físico maior | Migrations multiplicadas, dados públicos duplicados, ruim para agentes |
| C. Projeto Supabase por empresa | Isolamento total | Custo × N, operação inviável para dev solo |

## Decisão

**A.**

- Schemas: `core` (identidade e acesso), `pub` (dados públicos compartilhados, escrita só pelo worker), `priv` (dados da empresa), `ops` (operação), `audit` (log imutável).
- Toda tabela de `priv` tem `empresa_id not null`; toda policy chama `core.has_permission(empresa_id, modulo, acao)`.
- `has_permission` consulta `core.vinculos` × `core.permissoes` a cada chamada (sem permissões no JWT: revogação vale na hora). Perfis internos exigem `aal2`.
- Negar por padrão: RLS ligado em tudo; `auto_expose_new_tables = false`; grants explícitos.
- Segunda camada: o worker usa service role, então todo job valida no banco que o recurso pertence à `empresa_id` do job antes de agir.
- Service role nunca no front (hook + Semgrep).
- Teste A x B em pgTAP para cada tabela de `priv`; `scripts/check_isolation_coverage.py` falha o CI se faltar.

## Notas de implementação (Fase 01)

- **Teto de concessão:** quem tem `permissoes/administrar_permissoes` só concede permissões que ele mesmo tem na empresa e não amplia o próprio vínculo (só reduz). SUPERADMIN fica fora do teto. Assim, "Ver custos e margens" não vira consequência automática de administrar permissões.
- **Convites** ficam presos à conta do convidado, não ao e-mail atual.

## Consequências

- **Positivas:** uma regra só para testar; agentes têm padrão claro para copiar.
- **Negativas / risco residual:** custo de consulta por linha em listas grandes (aceitável para o volume do ano 1; otimizar com `(select ...)` e índices).
- **Gatilho para reavaliar:** p95 de consulta > 500 ms por causa de RLS, ou cliente que exija isolamento físico por contrato.
