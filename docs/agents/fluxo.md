# Fluxo de trabalho por fase

O "método obrigatório por fase" do Prompt Mestre adaptado a uma pessoa + agentes. Cada fase vira uma sequência de PRs pequenos.

```text
 spec ✋ ─► migration ✋ ─┬─► API / worker / rules ─┐
                         └─► app ──────────────────┴─► testes A x B + e2e ─► relatório ✋
```

## 1. Spec (`docs/specs/fase-XX.md`)

- Agente parte do Prompt Mestre (seção da fase) + plano + specs anteriores e preenche [`_modelo.md`](../specs/_modelo.md).
- Toda regra legal ou tributária fica marcada `⚖️ VALIDAR JURÍDICO` / `🧾 VALIDAR CONTADOR` até ser confirmada.
- Termina com **perguntas abertas** numeradas. Você responde, o agente incorpora, você muda status para `Aprovada`.
- PR só de docs: `docs/spec-fase-XX`.

## 2. Banco

- Um PR por grupo coeso de tabelas (ex.: "core: empresas + vínculos + permissões").
- Inclui: migration em `db/migrations/` (dbmate, com `-- migrate:down`), policies, grants, triggers, seed fictício necessário, pgTAP em `db/tests/` com isolamento A x B.
- `db/scripts/test-local.sh` sobe todas, desce todas e sobe de novo antes do pgTAP: o down também é testado.
- Agente roda `revisor-migration` antes de pedir sua revisão. Você lê **cada linha**.

## 3. Backend (`apps/api`, `apps/worker`)

- API NestJS: todo endpoint com `@Permissao` (ou na lista fechada de públicos) e consulta dentro de `comContexto`; e2e A x B em `apps/api/test/`.
- Worker: testes primeiro em `rules/`. Casos de prazo/preço vêm de fonte humana (jurídico/contador), com origem citada no teste.
- Jobs pela fila `ops.jobs`, idempotentes, com validação de `empresa_id`.

## 4. App (`apps/app`, Expo)

- Uma feature por PR. Começa em 360 px; web largo é melhoria.
- Toda chamada passa por `src/api/cliente.ts`; toda tela num `Stack.Protected` (o teste `src/rotas.test.ts` confere).
- Estados obrigatórios em toda tela: carregando, vazio, erro, sem permissão, sucesso.
- Recurso pela metade = selo EM DESENVOLVIMENTO.

## 5. Testes

- Positivos, negativos, permissão (cada ação da matriz), isolamento A x B, persistência (sai e entra, dado continua).
- Caminho principal da fase conferido no app web contra a API local, em 360 px e desktop.

Em todos os passos: a documentação é atualizada na mesma entrega ([`documentacao-viva.md`](documentacao-viva.md)).

## 6. Relatório (`docs/phase-reports/fase-XX.md`)

- Formato do Prompt Mestre ([`_modelo.md`](../phase-reports/_modelo.md)). Evidências em `docs/phase-reports/evidencias/fase-XX/`.
- `auditor-fase` confere; você aceita. Atualize `docs/roadmap.md`.

## Como fatiar uma fase em PRs

Regra prática: se o PR não cabe numa revisão de 20 minutos, está grande demais. O plano de PRs de cada fase fica na seção 7 da spec (exemplo real: [`fase-01.md`](../specs/fase-01.md) §7), e cada PR entregue é marcado ✅ lá.
