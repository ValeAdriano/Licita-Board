# Fluxo de trabalho por fase

O "método obrigatório por fase" do Prompt Mestre adaptado a uma pessoa + agentes. Cada fase vira uma sequência de PRs pequenos.

```text
 spec ✋ ─► migration ✋ ─► tipos gerados ─┬─► backend/rules ─┐
                                         └─► frontend ──────┴─► testes A x B + e2e ─► relatório ✋
```

## 1. Spec (`docs/specs/fase-XX.md`)

- Agente parte do Prompt Mestre (seção da fase) + plano + specs anteriores e preenche [`_modelo.md`](../specs/_modelo.md).
- Toda regra legal ou tributária fica marcada `⚖️ VALIDAR JURÍDICO` / `🧾 VALIDAR CONTADOR` até ser confirmada.
- Termina com **perguntas abertas** numeradas. Você responde, o agente incorpora, você muda status para `Aprovada`.
- PR só de docs: `docs/spec-fase-XX`.

## 2. Banco

- Um PR por grupo coeso de tabelas (ex.: "core: empresas + vínculos + permissões").
- Inclui: migration, policies, grants, triggers, seed fictício necessário, pgTAP de isolamento.
- Agente roda `revisor-migration` antes de pedir sua revisão. Você lê **cada linha**.
- Depois do merge: `npx supabase gen types typescript --local > packages/shared/src/database.types.ts` em PR próprio ou junto.

## 3. Backend (`apps/worker`, Edge Functions)

- Testes primeiro em `rules/`. Casos de prazo/preço vêm de fonte humana (jurídico/contador), com origem citada no teste.
- Jobs idempotentes com validação de `empresa_id`.

## 4. Frontend (`apps/web`)

- Uma feature por PR. Começa em 360 px.
- Estados obrigatórios em toda tela: carregando, vazio, erro, sem permissão, sucesso.
- Recurso pela metade = selo EM DESENVOLVIMENTO.

## 5. Testes

- Positivos, negativos, permissão (cada ação da matriz), isolamento A x B, persistência (sai e entra, dado continua).
- E2E Playwright para o caminho principal da fase, em mobile e desktop.

## 6. Relatório (`docs/phase-reports/fase-XX.md`)

- Formato do Prompt Mestre ([`_modelo.md`](../phase-reports/_modelo.md)). Evidências em `docs/phase-reports/evidencias/fase-XX/`.
- `auditor-fase` confere; você aceita. Atualize `docs/roadmap.md`.

## Como fatiar uma fase em PRs

Regra prática: se o PR não cabe numa revisão de 20 minutos, está grande demais. Exemplo para a Fase 01:

1. `docs/spec-fase-01` — spec.
2. `feat/fase-01-schemas-base` — schemas, extensões, helpers (`updated_at`, uuid v7), `audit.audit_log` + trigger genérico.
3. `feat/fase-01-core-empresas-vinculos` — `core.empresas`, `core.usuarios`, `core.vinculos`, `core.permissoes`, `has_permission()`, fixtures de teste A x B.
4. `feat/fase-01-step-up` — `core.step_up_tokens` + função de verificação.
5. `feat/fase-01-auth-front` — login, recuperação, MFA, sessões.
6. `feat/fase-01-shell` — layout, navegação, seletor de empresa, PWA base.
7. `feat/fase-01-matriz-permissoes` — tela da matriz.
8. `chore/fase-01-backup` — job de `pg_dump` + teste de restauração documentado.
9. `docs/relatorio-fase-01`.
