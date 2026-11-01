# Prompt · 03 Backend (worker / Edge Functions)

> Troque `<...>`. Pré-requisito: migration da fase no `main` e tipos gerados.

Implemente **"<job/serviço/regra>"** da spec `docs/specs/fase-<XX>.md` (requisitos `<RF-XX.n>`).

**Leia antes:** `AGENTS.md`, `apps/worker/AGENTS.md`, ADRs relevantes (`ADR-004` fila, `ADR-005` IA, `ADR-006` documentos).

**Faça, nesta ordem:**
1. Testes primeiro. Para `rules/`, cada caso de teste cita a origem (ex.: "caso 12 do jurídico VV, 2026-11-10"). Sem caso validado? Escreva o teste marcado `@pytest.mark.skip(reason="aguardando caso do jurídico")` e pergunte.
2. Implementação mínima que passa nos testes.
3. Job: idempotente, valida `empresa_id` no banco antes de agir, registra execução/erro, sem PII em log.
4. Integração externa: conector isolado, retry com backoff, fixture gravada no teste.
5. Rode `uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest --cov` e cole o resultado real.

**Não faça:** `float` para dinheiro; regra legal/tributária inventada; chamada de rede real em teste; LLM fora de `llm/`.
