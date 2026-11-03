# Roadmap e estado atual

Fonte para agentes saberem **onde estamos**. Atualizar ao abrir e ao fechar cada fase.

**Fase atual:** 00 · Fundação técnica — **recomeçando na stack nova** (revisão 2 do plano, 2026-11-02: Docker + Postgres + API NestJS + front React web + worker Python; ADR-011 a 018).
**Próximo passo:** Fase 01 em andamento: banco, API, fila/worker e front React web (PWA, design Apple; ADR-018) com login, MFA, conta, empresas, notificações, matriz de permissões e convites no main; próximo PR 9, Web Push. Adriano: instalar Docker; escolher VPS/S3.

> O trabalho da Fase 01 na revisão 1 (Supabase: migrations, RLS, pgTAP) fica congelado em `supabase/` até o fechamento da Fase 01. O front da revisão 1 (Vite) foi substituído pelo front novo em `apps/web`.

| Onda | Fase | Nome | Horas est. | Spec | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | 00 | Fundação técnica | ~40 h | [fase-00](specs/fase-00.md) · Em revisão | 🟡 banco, API, app, worker, CI e guardas no main; falta: rodar com Docker, produção (VPS), Sentry, ameaças revisadas |
| 1 | 01 | Arquitetura, segurança e acessos | ~90 h | [fase-01](specs/fase-01.md) · Aprovada (revisão 2) | 🟡 PRs 1–8 e 3b no main (banco, API de acesso, fila, telas de acesso, shell, matriz/convites); faltam push, backup, relatório e telas de auditoria/exclusão |
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
| Docker instalado na máquina de dev | Adriano | Rodar a stack local |
| Provedor da VPS (São Paulo) e do S3 de produção | Adriano | Deploy da Fase 00 |
| Destino do projeto Supabase `gqrilopolbanlrdyrrsd` | Adriano | — (custo/limpeza) |
| Domínio e identidade visual (logo, ícones do PWA) | Adriano | PWA em produção (Fase 01) |
