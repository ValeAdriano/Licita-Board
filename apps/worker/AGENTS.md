# apps/worker · regras locais

Complementa o `AGENTS.md` da raiz. Vale para tudo em `apps/worker/`.

## Stack

Python 3.12, `uv`, FastAPI (só `/health`), Pydantic v2, Ruff, mypy strict, pytest. Entram por fase: fila `ops.jobs` via `psycopg` (ADR-014, Fase 03/04), PyMuPDF + Tesseract (04), LiteLLM (06), `docxtpl` + LibreOffice (08), `num2words` (07). Toda dependência nova é registrada no PR.

## Regras

- **O worker conecta como `vv_worker` (BYPASSRLS, ADR-013), então ele é a segunda camada de isolamento.** Todo job que toca dado privado recebe `empresa_id` e valida, antes de agir, que o recurso pertence àquela empresa. Nunca confie no payload sem checar no banco.
- Jobs idempotentes: chave de idempotência por execução; rodar duas vezes não duplica efeito.
- Falha nunca é silenciosa: registrar em `ops.execucoes` com status e erro; agendador manda heartbeat.
- `rules/` é código puro: sem I/O, sem banco, sem IA, sem `datetime.now()` implícito (relógio entra por parâmetro para testes). 80% de cobertura mínima; `precos.py` 100%.
- **Dinheiro em `Decimal`.** `float` é bloqueado em `rules/` por hook e Semgrep. Quantize com a regra de arredondamento do edital.
- **IA:** só via `llm/`. Texto externo entra delimitado como dado; o modelo não tem ferramentas de escrita; saída validada por Pydantic; inválida vira `A CONFIRMAR`. Registrar modelo, versão do prompt e custo em `ops.llm_execucoes`. Não enviar custo, margem ou dado pessoal.
- **Conectores:** um por fonte, isolados. Retry com backoff, `User-Agent` identificado, respeito a termos de uso. Teste com fixture gravada, nunca rede real no CI.
- **Arquivos externos** (editais, anexos, uploads): quarentena → tamanho → tipo real (`python-magic`, lista permitida) → ClamAV → SHA-256 → bucket definitivo (ordem de `documentos.verificar`; o primeiro problema bloqueia). Nunca executar nem renderizar conteúdo. Para ensaiar o ClamAV real, o EICAR precisa estar dentro de um tipo permitido (ex.: arquivo interno de um `.docx`): EICAR solto para no tipo real.
- Logs JSON via `worker.logging`, sem PII. Datas sempre com fuso (`ruff` regra DTZ).

## Checks

```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest --cov
```
