# Roadmap e estado atual

Fonte para agentes saberem **onde estamos**. Atualizar ao abrir e ao fechar cada fase.

**Fase atual (2026-11-05):** Fases 00 a 04 construídas no `main` em modo rápido (rodam no Docker); a **spec da Fase 05 está em rascunho** aguardando aprovação. Stack: Docker + Postgres + API NestJS + front React (Untitled UI, PWA) + worker Python (ADR-011 a 020).
**Próximo passo:** Adriano aprova (ou ajusta) a spec da Fase 05 (`docs/specs/fase-05.md`) e decide o Compras.gov.br na Fase 04. Em paralelo, dependem de fora do código: planilha atual da agenda e 30+ casos de prazo do jurídico (Fase 05), 50 editais da amostra (Fase 04), VPS, bucket S3 e ensaio de restauração (Fases 00 e 01), decisões do jurídico e do contador.

> A revisão 1 (Supabase) foi removida do repositório no PR 11; o estado anterior está na tag `revisao-1-supabase`.

| Onda | Fase | Nome | Horas est. | Spec | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | 00 | Fundação técnica | ~40 h | [fase-00](specs/fase-00.md) · Em revisão | 🟡 banco, API, app, worker, CI e guardas no main; falta: rodar com Docker, produção (VPS), Sentry, ameaças revisadas |
| 1 | 01 | Arquitetura, segurança e acessos | ~90 h | [fase-01](specs/fase-01.md) · Aprovada (revisão 2) | 🟡 PRs 1–11 e 3b no main; relatório escrito, **aguardando aceite**. CA-1 a CA-5, CA-7 e CA-8 COMPROVADOS (CA-5 sem teste em navegador); CA-6 PARCIAL (falta o ensaio real). PR 12 entregue (primeiro SUPERADMIN, Caddy com CSP no CI, telas de plataforma, exclusão e auditoria); resta infraestrutura (VPS, bucket, ensaio de restauração) |
| 2 | 02 | Empresas, representantes e produtos | ~50 h | [fase-02](specs/fase-02.md) · Aprovada | 🟡 banco, API e telas no main (modo rápido); faltam testes A x B de priv, docs e decisões do jurídico/contador |
| 2 | 03 | Gestão documental e certidões | ~60 h | [fase-03](specs/fase-03.md) · Aprovada | 🟡 no main (modo rápido): repositório com quarentena e antivírus, versões, download auditado, alertas diários, pendência "Atualizar", atestados, checklist (regra pura); falta tela do checklist (com os editais), A x B de `priv`, retenção e ME/EPP do jurídico |
| 2 | 05 | Agenda e prazos jurídicos ★ MVP | ~70 h | [fase-05](specs/fase-05.md) · Aprovada | 🟡 no main (modo rápido): banco, cálculo de prazos, API e telas (calendário, prazos, acompanhamento); alertas e "Prazo perdido" prontos; exportação CSV pronta; falta importar planilha; aceite depende da planilha e dos 30 casos do jurídico |
| 3 | 04 | Motor de pesquisa (PNCP) | ~90 h | [fase-04](specs/fase-04.md) · Aprovada | 🟡 PNCP no main (modo rápido): coleta, arquivos, texto, relevância, API e telas; falta Compras.gov.br, embeddings, e2e A x B e a amostra de 50 editais |
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
| Aceite do relatório da Fase 01 e confirmação do CA-1 (SUPERADMIN vê todas as empresas) | Adriano | Fechar a Fase 01 |
| Destino do projeto Supabase `gqrilopolbanlrdyrrsd` | Adriano | — (custo/limpeza) |
| Domínio e identidade visual (logo, ícones do PWA) | Adriano | PWA em produção (Fase 01) |
| Bucket S3 de backup em **outro provedor** (R2/B2) com versionamento e object lock; cofre para a senha de cifra do backup e a `VV_KEK` (duas pessoas) | Adriano | Backup em produção e o 1º ensaio real de restauração (CA-6 completo) |
