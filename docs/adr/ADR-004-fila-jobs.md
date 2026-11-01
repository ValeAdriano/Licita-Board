# ADR-004 · Fila de jobs: `pgmq` + `pg_cron`, consumida pelo worker

- **Status:** Proposto
- **Data:** 2026-11-01
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 4.1, 0.5 ("agendador: filas e workers persistentes, com monitoramento")

## Contexto

Precisamos de varreduras às 07h, 12h e 17h (Brasília), jobs de extração, IA, DOCX e alertas diários, com alerta quando o agendador não roda.

## Alternativas

| Alternativa | Prós | Contras | Custo |
| --- | --- | --- | --- |
| A. **`pgmq` + `pg_cron` no próprio Supabase** | Sem infra extra; transacional com os dados; visível por SQL | Throughput limitado (irrelevante no volume atual) | US$ 0 |
| B. Redis + RQ/Celery | Ecossistema maduro | Mais um serviço para operar e proteger | US$ 5–15 |
| C. Fila gerenciada (SQS, Cloud Tasks) | Robusta | Outro provedor, outra credencial | baixo, + complexidade |

## Decisão

**A.** `pg_cron` enfileira mensagens em `pgmq`; o worker consome (`read` com visibility timeout, `delete` ao concluir, `archive` em falha definitiva). Horários em UTC no cron (07h/12h/17h BRT = 10h/15h/20h UTC; Brasil sem horário de verão desde 2019 — conferir se voltar). Cada execução grava `ops.execucoes` e pinga Healthchecks.io; ausência em 30 min alerta o SUPERADMIN.

## Consequências

- **Positivas:** tudo no Postgres, testável localmente.
- **Negativas / risco residual:** worker parado = fila acumula; mitigado pelo heartbeat externo.
- **Gatilho para reavaliar:** > 10 mil jobs/dia ou necessidade de prioridade/fan-out complexo.
