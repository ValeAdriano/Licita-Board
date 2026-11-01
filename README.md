# VV Licitações

Plataforma multiempresa para administrar licitações públicas, da oportunidade identificada ao recebimento: empresas e certidões, agenda com prazos jurídicos, captura de editais (PNCP), análise técnica com IA e evidência verificável, preços, propostas, peças jurídicas, contratos e financeiro.

> **Estado:** Fase 00 (fundação técnica). Nenhum módulo de negócio liberado. Ver [`docs/roadmap.md`](docs/roadmap.md).

## Para quem chega agora (pessoa ou agente de IA)

1. [`AGENTS.md`](AGENTS.md) — regras invioláveis, método por fase, comandos, convenções. **Leia antes de tocar em qualquer coisa.**
2. [`docs/roadmap.md`](docs/roadmap.md) — onde estamos.
3. [`docs/referencia/prompt-mestre-2.1.md`](docs/referencia/prompt-mestre-2.1.md) — requisitos.
4. [`docs/agents/`](docs/agents/) — fluxo de trabalho com agentes, prompts prontos, checklists, glossário.

## Stack

| Camada | Tecnologia | Onde |
| --- | --- | --- |
| Front (PWA) | Vite + React + TypeScript | `apps/web` → Vercel |
| Dados, auth, storage, fila | Supabase (Postgres + RLS, Auth, Storage, Vault, pg_cron, pgmq) | `supabase/` |
| Trabalho pesado | Python 3.12 + FastAPI (PNCP, PDF, OCR, IA, DOCX) | `apps/worker` → Railway |

Decisões e alternativas: [`docs/adr/`](docs/adr/).

## Rodando localmente

Pré-requisitos: Node 26 (`.nvmrc`), [uv](https://docs.astral.sh/uv/), Docker (para o Supabase local).

```bash
# Front
npm ci --prefix apps/web
cp apps/web/.env.example apps/web/.env.local
npm run dev --prefix apps/web

# Worker
cd apps/worker && uv sync && cp .env.example .env && uv run uvicorn worker.main:app --app-dir src --reload

# Banco
npx supabase start
npx supabase test db
```

## Qualidade e segurança

CI em [`.github/workflows/ci.yml`](.github/workflows/ci.yml): lint, typecheck, testes, pgTAP (RLS e isolamento A x B), Semgrep com regras próprias ([`.semgrep/`](.semgrep/)), Gitleaks, `npm audit`, `pip-audit`. Modelo de ameaças: [`docs/threat-model.md`](docs/threat-model.md).
