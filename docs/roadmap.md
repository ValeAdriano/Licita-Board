# Roadmap e estado atual

Fonte para agentes saberem **onde estamos**. Atualizar ao abrir e ao fechar cada fase.

**Fase atual:** 00 · Fundação técnica — em andamento (pendências de conta/infra). 01 · banco de acesso em desenvolvimento.
**Próximo passo:** Adriano revisar ADRs e modelo de ameaças; criar contas (Supabase Pro, Vercel, Railway, Sentry, Healthchecks.io); proteger `main`. Em paralelo: spec da Fase 01 (`/spec 01`).

| Onda | Fase | Nome | Horas est. | Spec | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | 00 | Fundação técnica | ~30 h | [fase-00](specs/fase-00.md) · Em revisão | 🟡 em andamento |
| 1 | 01 | Arquitetura, segurança e acessos | ~60 h | [fase-01](specs/fase-01.md) · Rascunho | 🟡 acesso, step-up, auth, shell/PWA e matriz/convites no main; falta: backup externo + relatório da fase |
| 2 | 02 | Empresas, representantes e produtos | ~50 h | — | ⚪ |
| 2 | 03 | Gestão documental e certidões | ~60 h | — | ⚪ |
| 2 | 05 | Agenda e prazos jurídicos ★ MVP | ~70 h | — | ⚪ bloqueada: planilha atual |
| 3 | 04 | Motor de pesquisa (PNCP) | ~90 h | — | ⚪ |
| 4 | 06 | IA para análise técnica (veículos) | ~100 h | — | ⚪ |
| 5 | 07 | Formação de preços | ~50 h | — | ⚪ |
| 5 | 08 | Propostas, declarações e habilitação | ~70 h | — | ⚪ |
| 5 | 10a | Jurídico pré-disputa (10.2–10.3) | ~45 h | — | ⚪ |
| 6 | 09 | Disputas e resultados | ~35 h | — | ⚪ |
| 6 | 10b | Jurídico pós-disputa (10.4–10.9) | ~65 h | — | ⚪ |
| 7 | 11 | Contratos, entregas e financeiro | ~60 h | — | ⚪ |
| 7 | 12 | Dashboard e relatórios | ~45 h | — | ⚪ |
| 8 | 13 | Integrações e expansão | ~80 h+ | — | ⚪ |

## Dependências externas abertas

| Dependência | De quem | Bloqueia |
| --- | --- | --- |
| Planilha Excel atual da agenda | Operação VV | Desenho final da Fase 05 |
| Tabela de regras de prazo + 30 casos de teste | Jurídico VV | Fase 05 |
| Contrato operador/controlador (LGPD) | Jurídico VV | 1º cliente real |
| Parâmetros tributários | Contador | Fase 07 |
| 50 editais da amostra de cobertura | Operação VV | Aceite da Fase 04 |
| 20 editais de veículos com gabarito | Operação VV | Aceite da Fase 06 |
| Decisão ADR-007 | Adriano | Fechamento da Fase 00 |
| Domínio e identidade visual | Adriano | PWA (Fase 01) |
