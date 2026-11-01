# Prompt · 01 Especificação de fase

> Cole em qualquer agente. Troque `<XX>`.

Você vai escrever a especificação da **Fase <XX>** do VV Licitações. Não escreva código.

**Leia antes:** `AGENTS.md`; a seção da Fase <XX> em `docs/referencia/prompt-mestre-2.1.md`; a Fase <XX> e o "Modelo de dados núcleo" em `docs/referencia/plano-desenvolvimento.md`; ADRs com status `Aceito` em `docs/adr/`; specs já aprovadas das fases anteriores; `docs/threat-model.md`; `docs/agents/glossario.md`.

**Produza** `docs/specs/fase-<XX>.md` seguindo `docs/specs/_modelo.md`, com:

1. Escopo: o que entra e, explicitamente, o que **não** entra (e em qual fase fica).
2. Requisitos numerados (`RF-<XX>.n`), cada um rastreado à seção do Prompt (ex.: "Prompt 3.3").
3. Modelo de dados: tabelas, colunas com tipo, constraints, índices, schema (`core/pub/priv/ops/audit`), policies RLS por operação com módulo/ação da matriz de permissões.
4. Regras de negócio. Regra legal → marcar `⚖️ VALIDAR JURÍDICO`; tributária → `🧾 VALIDAR CONTADOR`. Não invente valores: deixe `<A DEFINIR>`.
5. Permissões: tabela perfil × ação para cada tela/operação. Operações críticas com step-up.
6. Telas: lista de telas com estados (carregando, vazio, erro, sem permissão) e comportamento em 360 px.
7. Jobs/integrações: o que roda no worker, gatilho, idempotência, falha.
8. Ameaças: quais de T1–T7 a fase toca, controle e teste. Ameaça nova → proponha entrada no modelo.
9. Critérios de aceite: os do Prompt + os do plano, cada um com **como será comprovado** (teste automatizado, script, print).
10. Plano de PRs: sequência de PRs < 500 linhas.
11. Perguntas abertas numeradas, com sua recomendação em cada uma.

Status inicial: `Rascunho`. Pare e apresente as perguntas abertas. Não mude para `Aprovada`: isso é do Adriano.
