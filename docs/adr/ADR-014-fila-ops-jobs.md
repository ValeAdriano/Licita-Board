# ADR-014 · Fila `ops.jobs` com SKIP LOCKED e agendador no worker

- **Status:** Proposto
- **Data:** 2026-11-02
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 4.1, 0.5 ("agendador: filas e workers persistentes, com monitoramento")
- **Substitui:** ADR-004

## Contexto

Precisamos de varreduras às 07h, 12h e 17h (Brasília), jobs de extração, IA, DOCX, e-mail e alertas diários, com alerta quando o agendador não roda. A API (Node) enfileira e o worker (Python) consome. `pgmq` e `pg_cron` eram extensões do Supabase; no Postgres próprio seriam mais duas extensões para manter na imagem.

## Alternativas

| Alternativa | Prós | Contras | Custo |
| --- | --- | --- | --- |
| A. **Tabela `ops.jobs` + `FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY`; agendador (APScheduler) no worker** | SQL puro, igual em Node e Python; enfileirar é transacional com o dado; visível por SQL | Escrevemos retry/backoff (pouco código) | US$ 0 |
| B. `pgmq` + `pg_cron` compilados na imagem | Pronto | Duas extensões para manter; cron em UTC | US$ 0 |
| C. Redis + BullMQ/RQ | Maduro | Mais um serviço; clientes diferentes em Node e Python | RAM |
| D. pg-boss | Pronto em Node | Sem cliente Python oficial | US$ 0 |

## Decisão

**A.**

- `ops.jobs(id, tipo, empresa_id, payload jsonb, chave_idempotencia unique, status, tentativas, max_tentativas, disponivel_em, travado_ate, ultimo_erro, created_at, updated_at)`.
- A API insere o job na **mesma transação** do dado que o originou e dá `NOTIFY ops_jobs`. O payload leva só IDs, nunca dados sensíveis.
- O worker pega com `select ... for update skip locked`, define `travado_ate` (visibility timeout) e, ao terminar, marca `concluido`. Em erro, reagenda com backoff exponencial e, depois de `max_tentativas`, marca `falhou` e alerta.
- O agendador (APScheduler) roda **no fuso `America/Sao_Paulo`** e só enfileira, com chave de idempotência por janela (ex.: `pncp:2026-11-02T07`), para não duplicar se houver dois workers.
- Cada execução grava `ops.execucoes` e pinga o Healthchecks.io; ausência em 30 min alerta o SUPERADMIN.

## Consequências

- **Positivas:** tudo no Postgres, testável localmente; nenhum serviço extra.
- **Negativas / risco residual:** worker parado = fila acumula (mitigado pelo heartbeat externo e por uma métrica de idade do job mais antigo).
- **Desvio do Prompt Mestre:** nenhum.
- **Gatilho para reavaliar:** mais de 10 mil jobs/dia, ou necessidade de prioridade/fan-out complexo.
