# Registro de decisões de arquitetura (ADR)

Cada decisão tem contexto, alternativas, decisão, consequências, custo e data (Prompt Mestre 0.1). Modelo: [`_modelo.md`](_modelo.md). Nova ADR: prompt [`docs/agents/prompts/nova-adr.md`](../agents/prompts/nova-adr.md) ou `/adr` no Claude Code.

Só o Adriano muda status para **Aceito**. Agentes tratam ADR `Proposto` como intenção, não como regra.

| ADR | Título | Status |
| --- | --- | --- |
| [001](ADR-001-stack.md) | Stack: Vite + React + TS, Supabase, worker Python, Vercel, Railway | Proposto |
| [002](ADR-002-autenticacao.md) | Autenticação: Supabase Auth adaptado | Proposto |
| [003](ADR-003-multi-tenant-rls.md) | Multi-tenant: `empresa_id` + RLS + `has_permission()` | Proposto |
| [004](ADR-004-fila-jobs.md) | Fila de jobs: `pgmq` + `pg_cron` | Proposto |
| [005](ADR-005-ia-multi-provedor.md) | IA multi-provedor: LiteLLM, chave VV, BYOK no Vault | Proposto |
| [006](ADR-006-geracao-documentos.md) | Documentos: `docxtpl` + LibreOffice headless | Proposto |
| [007](ADR-007-cofre-certificados.md) | Certificados A1 e senhas de portal (adiar) | Proposto · decisão pendente |
| [008](ADR-008-busca.md) | Busca: full-text português + `pgvector` | Proposto |
| [009](ADR-009-ambientes.md) | Ambientes: dev local + prod; homologação no 1º cliente | Proposto |
| [010](ADR-010-pwa.md) | PWA + Web Push VAPID | Proposto |
