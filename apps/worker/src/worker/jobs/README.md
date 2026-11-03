# jobs/

Um módulo por tipo de job da fila `ops.jobs` (ADR-014) (ex.: `pncp_sync.py`, `extract_pdf.py`, `render_docx.py`).

Regras:
- Job idempotente: recebe `idempotency_key` e não duplica efeito se rodar duas vezes.
- Todo job recebe `empresa_id` quando toca dado privado e valida o vínculo antes de agir (2ª camada de isolamento, ADR-003).
- Resultado e erro gravados em `ops.execucoes`; nunca falhar em silêncio.
