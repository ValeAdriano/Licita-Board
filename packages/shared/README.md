# packages/shared

Contratos compartilhados entre front e worker, gerados a partir do banco (fonte da verdade = migrations).

- `src/database.types.ts`: gerado por `npx supabase gen types typescript --local`. Nunca editar à mão.
- Enums e schemas Zod do domínio (status de participação, ações de permissão...).
- Os modelos Pydantic do worker espelham os mesmos tipos; divergência é bug.

Ativado na Fase 01, quando existir a primeira migration.
