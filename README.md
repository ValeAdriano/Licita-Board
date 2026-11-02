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

> **Não mantenha o repositório em pasta sincronizada pelo iCloud** (Mesa e Documentos). O iCloud tira arquivos do disco e duplica arquivos do `.git`, travando testes e builds. Use, por exemplo, `~/Developer/Licita-Board`.

```bash
# Front
npm ci --prefix apps/web
cp apps/web/.env.example apps/web/.env.local
npm run dev --prefix apps/web

# Worker
cd apps/worker && uv sync && cp .env.example .env && uv run uvicorn worker.main:app --app-dir src --reload

# Banco (Docker): sobe Postgres + Auth + Studio e aplica migrations e seed fictício
npx supabase start
npx supabase status        # mostra a URL e a chave pública (anon) para o apps/web/.env.local
npx supabase test db
```

### Entrando no sistema (local)

1. `npx supabase start` e copie `API URL` e `anon key` para `apps/web/.env.local`.
2. `npm run dev --prefix apps/web` e abra http://127.0.0.1:5173.
3. Entre com um usuário fictício do [`supabase/seed.sql`](supabase/seed.sql) (os e-mails e a senha de desenvolvimento estão no cabeçalho do arquivo).
4. Perfis internos cadastram o autenticador (MFA) no primeiro acesso. E-mails de recuperação de senha chegam no Mailpit local: http://127.0.0.1:54324.

Sem Docker, `scripts/db-local/test.sh` roda migrations e testes num Postgres local, mas não sobe o Auth: não dá para fazer login.

## Qualidade e segurança

CI em [`.github/workflows/ci.yml`](.github/workflows/ci.yml): lint, typecheck, testes, pgTAP (RLS e isolamento A x B), Semgrep com regras próprias ([`.semgrep/`](.semgrep/)), Gitleaks, `npm audit`, `pip-audit`. Modelo de ameaças: [`docs/threat-model.md`](docs/threat-model.md).
