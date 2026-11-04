# packages/shared

Contratos compartilhados entre front, API e worker, gerados a partir do banco (fonte da verdade = migrations).

- `src/database.types.ts`: gerado a partir do schema do banco (gerador a definir ao ativar o pacote). Nunca editar à mão.
- Enums e schemas Zod do domínio (status de participação, ações de permissão...).
- Os modelos Pydantic do worker espelham os mesmos tipos; divergência é bug.

Ainda não ativado: a API e o front mantêm seus tipos por enquanto; decidir na Fase 02.
