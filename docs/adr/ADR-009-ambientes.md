# ADR-009 · Ambientes: dev local + produção; homologação no 1º cliente real

- **Status:** Substituído por ADR-015 (2026-11-02, troca de stack)
- **Data:** 2026-11-01
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 0.2

## Contexto

O Prompt exige DESENVOLVIMENTO, HOMOLOGAÇÃO e PRODUÇÃO separados, com bancos, buckets e chaves distintos, e proíbe dado real fora de produção. No início não há cliente real, e cada projeto Supabase Pro custa.

## Alternativas

| Alternativa | Prós | Contras | Custo |
| --- | --- | --- | --- |
| A. **Dev local (Supabase CLI) + produção; homologação via Supabase Branching quando entrar o 1º cliente** | Custo baixo; dev 100% fictício | Sem homologação permanente no começo | US$ 25 |
| B. Três projetos desde o início | Atende à risca | Paga homologação sem uso | US$ 50+ |

## Decisão

**A.**

- **Dev:** `supabase start` local, `seed.sql` fictício, faixa laranja "DESENVOLVIMENTO". Preview da Vercel aponta para dev/branch, nunca para prod.
- **Produção:** projeto Supabase Pro, deploy só pelo pipeline do `main`.
- **Homologação:** Supabase Branching + preview da Vercel, faixa roxa, dados anonimizados — ligada **antes** do 1º cliente real.
- Chaves, buckets e segredos distintos por ambiente; nenhuma chave de prod em máquina de dev.

## Consequências

- **Desvio do Prompt Mestre:** homologação adiada até o 1º cliente real. Até lá, só a equipe VV usa produção, sem dados de clientes externos.
- **Gatilho para reavaliar:** contrato do 1º cliente real (bloqueante).
