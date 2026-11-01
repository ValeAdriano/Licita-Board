# ADR-001 · Stack: Vite + React + TS, Supabase, worker Python, Vercel, Railway

- **Status:** Proposto
- **Data:** 2026-11-01
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre, "Padrão técnico" (arquitetura sugerida) e 0.1

## Contexto

O Prompt sugere Next.js + FastAPI + PostgreSQL com RLS + S3 + filas/workers. A equipe é uma pessoa com agentes de IA, volume do ano 1 é ~10 empresas / ~20 usuários, e o orçamento inicial é baixo. O produto precisa ser PWA mobile-first.

## Alternativas

| Alternativa | Prós | Contras | Custo mensal estimado |
| --- | --- | --- | --- |
| A. Next.js + FastAPI + Postgres gerenciado + S3 (sugestão do Prompt) | Cookie HttpOnly nativo via BFF; controle total | Muito mais código de infraestrutura (auth, storage, filas, RLS manual); mais superfície para um dev solo | US$ 60–120 |
| B. **Vite SPA + Supabase (Postgres/RLS/Auth/Storage/Vault/cron/pgmq) + worker Python** | Auth, storage, RLS, cron e fila prontos; RLS como camada principal de autorização; menos código | JWT no client (ver ADR-002); dependência de fornecedor (mitigada: é Postgres padrão, exportável) | US$ 30–50 |
| C. Next.js + Supabase | SSR, cookie via `@supabase/ssr` | Hospedagem Node, complexidade de SSR sem necessidade (app autenticado, sem SEO) | US$ 45–70 |

## Decisão

**B.** Front em Vite + React + TypeScript (SPA/PWA) na Vercel; Supabase Pro como núcleo de dados, auth e segurança; worker Python 3.12 + FastAPI no Railway para PNCP, PDFs, OCR, IA, DOCX/PDF, antivírus e jobs. Edge Functions só para coisas leves (signed URL auditada, webhooks).

## Consequências

- **Positivas:** menos código próprio de segurança; RLS testável com pgTAP; dois deploys simples.
- **Negativas / risco residual:** sessão no client (ADR-002); Vault no mesmo banco (ADR-007); limites de Edge Functions empurram trabalho pesado para o worker.
- **Desvio do Prompt Mestre:** Next.js → Vite SPA; backend FastAPI só para jobs, autorização principal no RLS. A segunda camada de isolamento é o worker validando `empresa_id` (ADR-003).
- **Gatilho para reavaliar:** virada para SaaS aberto (> 50 empresas) ou exigência contratual de cookie HttpOnly → avaliar BFF.
