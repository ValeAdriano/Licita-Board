# VV Licitações

Plataforma multiempresa para administrar licitações públicas, da oportunidade identificada ao recebimento: empresas e certidões, agenda com prazos jurídicos, captura de editais (PNCP), análise técnica com IA e evidência verificável, preços, propostas, peças jurídicas, contratos e financeiro.

> **Estado:** Fase 01 (arquitetura, segurança e controle de acessos) com todos os PRs entregues e relatório aguardando aceite ([`docs/phase-reports/fase-01.md`](docs/phase-reports/fase-01.md)). Nenhum módulo de negócio liberado ainda. Ver [`docs/roadmap.md`](docs/roadmap.md).

## Para quem chega agora (pessoa ou agente de IA)

1. [`AGENTS.md`](AGENTS.md) — regras invioláveis, método por fase, comandos, convenções. **Leia antes de tocar em qualquer coisa.**
2. [`docs/roadmap.md`](docs/roadmap.md) — onde estamos.
3. [`docs/referencia/prompt-mestre-2.1.md`](docs/referencia/prompt-mestre-2.1.md) — requisitos.
4. [`docs/agents/`](docs/agents/) — fluxo de trabalho com agentes, prompts prontos, checklists, glossário.

## Stack

| Camada | Tecnologia | Onde |
| --- | --- | --- |
| Front (PWA) | React 19 + Vite + TypeScript (design Apple, claro e escuro) | `apps/web` |
| API | NestJS (Node 26) + Kysely; sessão em cookie HttpOnly, CSRF, guard por permissão | `apps/api` |
| Banco | PostgreSQL 17 com RLS em duas camadas, migrations SQL (dbmate), testes pgTAP | `db/` |
| Trabalho pesado | Python 3.12: fila `ops.jobs`, e-mail, Web Push (depois PNCP, PDF, OCR, IA) | `apps/worker` |
| Infra | Docker Compose; backup com pgBackRest (WAL, full, diferencial, cifrado, PITR) | `compose.yml`, `infra/` |

Decisões e alternativas: [`docs/adr/`](docs/adr/). O projeto saiu do Supabase (ADR-011); a revisão 1 existe só no histórico do git (tag `revisao-1-supabase`).

## Rodando localmente

Pré-requisitos: Node 26 (`.nvmrc`), [uv](https://docs.astral.sh/uv/), Docker.

> **Não mantenha o repositório em pasta sincronizada pelo iCloud** (Mesa e Documentos). O iCloud tira arquivos do disco e duplica arquivos do `.git`, travando testes e builds. Use, por exemplo, `~/Developer/Licita-Board`.

```bash
scripts/dev-env.sh                      # gera o .env de dev com senhas aleatórias (uma vez)
docker compose up -d --build            # postgres, api, worker e mailpit
docker compose run --rm dbmate up       # aplica db/migrations

npm ci --prefix apps/web
npm run dev --prefix apps/web           # http://localhost:5173 (o Vite repassa /api para a API)
```

Todo e-mail enviado em desenvolvimento aparece no Mailpit: http://localhost:8025.

O primeiro usuário (SUPERADMIN) e, em dev, uma empresa fictícia saem de um comando que roda como `vv_owner`:

```bash
set -a && . ./.env && set +a && export DATABASE_URL="postgres://vv_owner:$VV_OWNER_PASSWORD@localhost:5433/vv"
node scripts/criar-usuario.mjs --email voce@empresa.com.br --nome "Seu Nome" --superadmin --ficticio
```

No primeiro login ele pede o cadastro do autenticador (MFA). Detalhes e cuidados no cabeçalho de [`scripts/criar-usuario.mjs`](scripts/criar-usuario.mjs).

Testes de cada pacote e do banco: ver os comandos em [`AGENTS.md`](AGENTS.md) §6.

## Qualidade e segurança

CI em [`.github/workflows/ci.yml`](.github/workflows/ci.yml): lint, typecheck, testes, pgTAP (RLS e isolamento A x B), e2e da API (A x B por endpoint), restauração de backup provada, Semgrep com regras próprias ([`.semgrep/`](.semgrep/)), Gitleaks, `npm audit`, `pip-audit`. Modelo de ameaças: [`docs/threat-model.md`](docs/threat-model.md).
