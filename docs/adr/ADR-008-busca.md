# ADR-008 · Busca: Postgres full-text (`portuguese`) + `pgvector`

- **Status:** Proposto
- **Data:** 2026-11-01
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 4.4, 4.8, 12.4

## Contexto

Relevância de oportunidades por palavra-chave e por semântica (produto que só aparece no TR/anexos), pesquisa histórica em editais, documentos, produtos e peças.

## Alternativas

| Alternativa | Prós | Contras |
| --- | --- | --- |
| A. **`tsvector` (config `portuguese` + `unaccent`) + `pgvector`** | Mesmo banco, respeita RLS, sem sync | Ranking menos sofisticado que motor dedicado |
| B. Meilisearch/Typesense | Busca excelente | Outro serviço; RLS precisa ser replicado (risco de vazamento) |
| C. Elastic/OpenSearch | Poderoso | Caro e pesado para o volume |

## Decisão

**A.** `pub.trechos` guarda texto + arquivo + página + `tsvector` + embedding. Relevância = combinação de full-text e similaridade com o catálogo da empresa; nota baixa vai para "Baixa relevância", nunca some. Modelo de embedding definido na Fase 04, registrado em `ops`.

## Consequências

- **Gatilho para reavaliar:** > 5 milhões de trechos ou p95 de busca > 1 s.
