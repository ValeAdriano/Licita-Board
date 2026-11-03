# Registro de decisões de arquitetura (ADR)

Cada decisão tem contexto, alternativas, decisão, consequências, custo e data (Prompt Mestre 0.1). Modelo: [`_modelo.md`](_modelo.md). Nova ADR: prompt [`docs/agents/prompts/nova-adr.md`](../agents/prompts/nova-adr.md) ou `/adr` no Claude Code.

Só o Adriano muda status para **Aceito**. Agentes tratam ADR `Proposto` como intenção, não como regra.

| ADR | Título | Status |
| --- | --- | --- |
| [001](ADR-001-stack.md) | Stack: Vite + React + TS, Supabase, worker Python, Vercel, Railway | Substituído por 011 |
| [002](ADR-002-autenticacao.md) | Autenticação: Supabase Auth adaptado | Substituído por 012 |
| [003](ADR-003-multi-tenant-rls.md) | Multi-tenant: `empresa_id` + RLS + `has_permission()` | Substituído por 013 |
| [004](ADR-004-fila-jobs.md) | Fila de jobs: `pgmq` + `pg_cron` | Substituído por 014 |
| [005](ADR-005-ia-multi-provedor.md) | IA multi-provedor: LiteLLM, chave VV, BYOK (cifragem: ver 017) | Proposto |
| [006](ADR-006-geracao-documentos.md) | Documentos: `docxtpl` + LibreOffice headless | Proposto |
| [007](ADR-007-cofre-certificados.md) | Certificados A1 e senhas de portal (adiar) | Proposto · decisão pendente |
| [008](ADR-008-busca.md) | Busca: full-text português + `pgvector` | Proposto |
| [009](ADR-009-ambientes.md) | Ambientes: dev local + prod; homologação no 1º cliente | Substituído por 015 |
| [010](ADR-010-pwa.md) | PWA + Web Push VAPID | Substituído por 016 |
| [011](ADR-011-stack-docker-node-expo.md) | Stack: Docker Compose, Postgres 17, NestJS, Expo, worker Python, VPS | Proposto |
| [012](ADR-012-autenticacao-propria.md) | Autenticação própria: Argon2id, sessão opaca, TOTP, step-up | Proposto |
| [013](ADR-013-multi-tenant-duas-camadas.md) | Multi-tenant em duas camadas: guard NestJS + RLS por contexto | Proposto |
| [014](ADR-014-fila-ops-jobs.md) | Fila `ops.jobs` (SKIP LOCKED) + agendador no worker | Proposto |
| [015](ADR-015-ambientes-docker.md) | Ambientes: Docker Compose em dev, homologação e produção | Proposto |
| [016](ADR-016-app-expo.md) | App: Expo para iOS, Android e Web; push nativo + Web Push | Proposto |
| [017](ADR-017-arquivos-e-criptografia.md) | Arquivos em S3 compatível + criptografia de campo em envelope | Proposto |
