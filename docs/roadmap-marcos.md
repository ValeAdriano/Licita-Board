# Roadmap por marcos, MVP e sprints

Visão de gestão do VV Licitações: **o que já foi construído, o que falta, onde está o MVP e em que ordem fechar o resto**.
Complementa [`roadmap.md`](roadmap.md) (estado técnico por fase) e [`agents/COMECE-AQUI.md`](agents/COMECE-AQUI.md) (como retomar o trabalho).
Atualizado em **2026-11-05**. Estimativas de horas vêm do plano original (~950 h no total); as datas dos sprints futuros são relativas ("semana N"), porque dependem de decisões e materiais do Adriano e do jurídico.

> **Leitura honesta do estado:** tudo abaixo foi construído em **modo rápido** (AGENTS.md §0): 138 commits em 5 dias, direto no `main`, sem revisão linha a linha, sem CI ligado e sem aceite formal de nenhuma fase. Há muito código funcionando no Docker, mas **nada foi endurecido, validado pelo jurídico/contador nem usado com dado real**. A IA do produto **nunca rodou com chave real**. O próximo ganho não é mais funcionalidade: é transformar o que existe em algo em que se possa confiar.

---

## 1. Onde estamos

### 1.1 Retrospectiva (sprints já feitos)

| Sprint | Quando | O que entrou |
| --- | --- | --- |
| **S0 · Fundação** | 01–02/nov | Monorepo, Docker Compose, Postgres 17 com RLS e dbmate, API NestJS, app React PWA, worker Python, guardas (Semgrep, hooks), ADRs 001–020. Fase 01: login, MFA, convites, papéis e permissões por módulo, auditoria, exclusão com dupla aprovação, isolamento entre empresas (ADR-013). |
| **S1 · Cadastros e coleta** | 03/nov | Fase 02 (empresas, representantes, produtos), Fase 03 (documentos com quarentena + antivírus, versões, certidões, atestados, checklist em código puro), Fase 04 (coleta do PNCP, arquivos, texto, relevância, API e telas). |
| **S2 · Agenda ★** | 04/nov | Fase 05: cálculo de prazos em código puro (dias úteis e feriados), calendário, acompanhamentos, alertas D-5/D-3/D-1/dia, escalonamento, "Prazo perdido", exportação `.ics`/CSV, diff e reavaliação ao retificar edital. Redesenho da UI (Untitled UI), MFA opcional só em dev (ADR-021), usuário de teste dos agentes. |
| **S3 · Edital → proposta** | 04–05/nov | Fase 06 (requisitos, matriz técnica, evidência verificável, extração por IA com chave **por empresa** cadastrada na tela), Fase 07 (formação de preços em `Decimal`, sigilo de custos, alçada), Fase 08 (proposta com validação, aprovação, `.docx`/PDF final com hash e bloqueio), Fase 09 (resultado por item, gatilho de recurso na agenda). |
| **S4 · Jurídico, contratos, painel** | 05/nov | Fase 10 quase completa: base jurídica verificada, peças com fluxo e aprovação, conferência de citações, final com hash, protocolo humano, **minuta por IA**, **recurso de terceiros e contrarrazões**, **parecer de viabilidade recursal e peça de recurso**, **sugestões de esclarecimento e impugnação**. Fase 11 (contratos, empenhos, entregas, financeiro) e Fase 12 (painel com 13 indicadores por permissão, relatório comercial). |

Verificações da última rodada completa: pgTAP (todos os arquivos, inclusive isolamento A×B), API e2e **148 testes / 23 arquivos**, worker pytest + ruff + mypy limpos, web **106 testes**, build ok, fluxos conferidos na stack real com o usuário de teste.

### 1.2 Situação por fase

Legenda: ✅ feito · 🟡 parcial · ⚪ não iniciado. **Construído** = código no `main`. **Endurecido** = testes A×B, revisão e relatório de fase. **Aceito** = o Adriano aceitou. Hoje nenhuma fase está endurecida/aceita por completo.

| Fase | Horas | Construído | Falta construir | Bloqueios externos |
| --- | --- | --- | --- | --- |
| 00 Fundação | 40 | ✅ stack local, guardas | produção (VPS, S3, Sentry), ameaças revisadas | VPS, S3, domínio, ADR-007 |
| 01 Acessos | 90 | ✅ completa no código | ensaio real de restauração (CA-6), aceite do relatório | bucket de backup em outro provedor, cofre da KEK |
| 02 Empresas/produtos | 50 | ✅ | A×B das tabelas `priv`, decisões jurídicas | jurídico/contador |
| 03 Documentos/certidões | 60 | ✅ | tela do checklist por edital, retenção, regra ME/EPP | jurídico |
| **05 Agenda ★ (MVP)** | 70 | ✅ calendário, prazos, alertas, `.ics`, diff | **importar planilha**, feriados municipais, D-N por empresa | **planilha atual + 30 casos de prazo do jurídico** (as regras NÃO estão validadas) |
| 04 Pesquisa | 90 | 🟡 PNCP completo | Compras.gov.br, embeddings, ZIP/upload manual | decisão Compras.gov.br, 50 editais de amostra |
| 06 Análise técnica (IA) | 100 | 🟡 requisitos, matriz, extração por IA | ficha técnica privada, alternativas (6.4), **primeiro uso real da IA**, gabarito | chave da IA, 20 editais com gabarito |
| 07 Preços | 50 | 🟡 núcleo | histórico PNCP, empate ficto na tela, reautenticação, cenários | 🧾 contador (tributos), ⚖️ empate/inexequibilidade |
| 08 Propostas | 70 | 🟡 proposta, `.docx`/PDF final | modelo oficial/papel timbrado, declarações (8.4), checklist (8.5), comprovante de envio | modelos oficiais, papel timbrado |
| 09 Disputas/resultados | 35 | 🟡 núcleo | documentos posteriores (9.5), alerta em tempo real | — |
| 10 Jurídico | 45 + 65 | 🟡 ~85%: 10.1–10.7 prontos | banco de teses (10.8), indicadores (10.9), reautenticação na aprovação, upload de PDF do recurso, checklist numérico da concorrente, busca automática de sugestões | ⚖️ base de fontes, modelos de peça e prazos do jurídico |
| 11 Contratos | 60 | 🟡 núcleo | anexos por etapa, notificações dos alertas, contrato automático a partir de "contratada" | — |
| 12 Dashboard | 45 | 🟡 núcleo | relatório diário por e-mail, margens e preços anteriores, busca avançada, Excel/PDF | — |
| 13 Integrações | 80+ | ⚪ sem spec | tudo | decisão de escopo do Adriano |

Estimativa grosseira: **~80% do código planejado existe**, mas **menos de 30% do caminho até "usável por cliente real"** está percorrido, porque o que falta é endurecimento, infraestrutura e validação externa, não telas.

---

## 2. MVP

### 2.1 Definição

O plano original marca a **Fase 05 (Agenda) como ★ MVP**: o produto vale por não perder prazo jurídico. O MVP proposto, para a **primeira empresa real**, é:

> A empresa se cadastra, mantém seus documentos e certidões em dia, acompanha editais captados do PNCP e **recebe prazos jurídicos corretos, com alertas e escalonamento**, sem que um prazo seja perdido nem um dado vaze para outra empresa.

| Entra no MVP | Fica fora (pós-MVP) |
| --- | --- |
| Fases 00–03 (fundação, acessos, empresas, documentos), 04 (pesquisa PNCP) e 05 (agenda) | IA de análise técnica, preços, propostas, contratos, painel completo |
| Peças jurídicas **manuais** (base verificada, fluxo, aprovação, protocolo humano) como apoio à agenda | Minuta/leitura/sugestões **por IA** (já existem, ficam desligadas até a chave real e o gabarito) |
| Produção: VPS, S3, backup com ensaio de restauração, Sentry, domínio, TLS | Integrações da Fase 13 |

### 2.2 Critérios de saída do MVP (todos obrigatórios)

1. **Isolamento:** teste A×B de toda tabela `priv` e de todo endpoint (regra 13) e e2e rodando limpos; revisão de segurança dos módulos de acesso e documentos.
2. **Prazos corretos:** as ≥30 hipóteses do jurídico passam; as regras em `pub.regras_prazo` ganham o selo de validação (`validada_por`); planilha atual importada sem perda.
3. **Produção:** deploy na VPS em São Paulo, backup em outro provedor com object lock e **1º ensaio real de restauração** documentado.
4. **LGPD:** contrato operador/controlador assinado; política de retenção de documentos definida pelo jurídico.
5. **Operação:** relatório de fase aceito pelo Adriano para as Fases 00–05 e CI religado (sob demanda) verde.
6. **Sem conta real em teste:** nenhum fluxo de teste usa `acsvalefilho@gmail.com`; produção **sem** a chave `vv.mfa='opcional'` (ADR-021).

---

## 3. Marcos

| Marco | Nome | Entrega | Depende de | Sprints |
| --- | --- | --- | --- | --- |
| **M0** | Construção base (feito) | Fases 00–12 com núcleo no `main` | — | S0–S4 ✅ |
| **M1** | Base endurecida | Tudo do `main` com A×B, revisões e relatórios; CI verde sob demanda; ameaças revisadas | M0 | S5 |
| **M2** | Produção pronta | VPS, S3, backup restaurado, Sentry, domínio, PWA com ícones | decisões e contas do Adriano | S6 |
| **M3 ★** | **MVP** (Agenda + Documentos + Pesquisa PNCP) | Critérios de 2.2 cumpridos; piloto com 1 empresa real | M1, M2, jurídico (prazos, LGPD) | S7–S8 |
| **M4** | IA real validada | Chave real, gabarito de 20 editais, métricas de qualidade da extração, da minuta, da leitura de recurso e das sugestões | chave da IA, 20 editais com gabarito | S9 |
| **M5** | Do edital à proposta | Fases 06–08 aceitas (preços com tributos validados, modelo oficial, declarações, checklist) | contador, modelos oficiais, papel timbrado | S10 |
| **M6** | Jurídico completo | Base de fontes do jurídico, modelos de peça, teses e indicadores, reautenticação, parecer testado em casos reais | jurídico | S11 |
| **M7** | Pós-disputa e gestão | Resultados com documentos posteriores, contratos com anexos e notificações, relatórios (e-mail, Excel, PDF) | M5, M6 | S12 |
| **M8** | Expansão | Spec e primeira entrega da Fase 13 (integrações; apps nativos adiados no ADR-018) | decisão de escopo | S13+ |

Ordem de valor: **M1 → M2 → M3 (MVP) → M4 → M5 → M6 → M7 → M8**. M4 pode andar em paralelo a M3 se a chave e o gabarito chegarem antes (a IA não bloqueia o MVP).

---

## 4. Plano de sprints (próximos)

Sprints de **1 semana de trabalho efetivo**, supondo agentes em paralelo (uma tarefa = um agente, só um por vez em `db/migrations/`). Itens em **negrito** dependem de algo de fora.

| Sprint | Objetivo | Principais entregas | Saída (como saber que acabou) |
| --- | --- | --- | --- |
| **S5 · Endurecimento** (M1) · 🟡 em andamento: **feito** teste A×B das 48 tabelas `priv` (guarda verde) e reautenticação nas aprovações de peça, proposta e preço abaixo do mínimo; **falta** CI sob demanda verde, revisão de segurança por bloco, relatórios de fase 00–05 e revisão do threat-model | Transformar o `main` em base confiável | Auditar A×B de **todas** as tabelas `priv` e rotas (fases 02, 03 e as novas 10–12); religar o CI sob demanda e deixá-lo verde; rodar `revisor-migration`, `revisor-seguranca` e `auditor-fase` por bloco; revisar `threat-model.md`; reautenticação na aprovação de peça (10) e de preço (07); relatórios de fase 00–05 | pgTAP + e2e + CI verdes; lacunas dos auditores zeradas ou registradas |
| **S6 · Produção** (M2) | Subir o produto fora do laptop | **VPS (São Paulo), S3 de produção, bucket de backup em outro provedor com object lock, cofre da KEK/senha de backup, domínio e identidade visual**; compose de produção; Sentry; ensaio de restauração (CA-6) | app em produção com TLS; backup restaurado e cronometrado; produção sem `vv.mfa` |
| **S7 · Agenda aceita** (M3) | Prazos em que se pode confiar | **Planilha atual da operação → importador**; **30+ casos de prazo do jurídico viram testes**; selo de validação nas regras; feriados municipais e D-N por empresa; tela do checklist por edital (03) | casos do jurídico 100% verdes; planilha importada com relatório de divergências |
| **S8 · Pesquisa aceita + LGPD** (M3) | Fechar o MVP | **Decisão Compras.gov.br** (recomendação: só conferência cruzada); **50 editais de amostra** para medir cobertura; ZIP/upload manual; embeddings; **contrato operador/controlador e política de retenção**; piloto assistido com 1 empresa | Fase 04 e 05 aceitas; critérios de 2.2 todos cumpridos → **MVP** |
| **S9 · IA real** (M4) | Provar que a IA presta | **Chave real cadastrada na tela**; **20 editais de veículos com gabarito**; medir extração de requisitos, minuta, leitura de recurso, parecer e sugestões; ajustar prompts; ficha técnica privada e alternativas (6.4) | relatório de qualidade por recurso de IA; decisão de ligar ou manter desligado cada um |
| **S10 · Preço e proposta** (M5) | Fases 07 e 08 prontas para uso | **Parâmetros tributários do contador** e ⚖️ empate/inexequibilidade; histórico PNCP; empate ficto na tela; cenários; **modelo oficial e papel timbrado**; declarações (8.4); checklist de habilitação (8.5); comprovante de envio | proposta final no modelo oficial; cálculo conferido pelo contador |
| **S11 · Jurídico fechado** (M6) | Fase 10 completa | **Base de fontes oficiais e modelos de peça do jurídico**; banco de teses (10.8) e indicadores (10.9); upload de PDF do recurso e dos documentos da concorrente; checklist numérico da concorrente (validade de certidões na data, índices); busca de sugestões ao indexar o edital; testar o fluxo com casos reais | CA da Fase 10 comprovados; jurídico assina o aceite |
| **S12 · Pós-disputa e gestão** (M7) | Fases 09, 11 e 12 completas | Documentos posteriores (9.5); contratos: anexos por etapa, notificações dos alertas, contrato automático a partir de "contratada"; relatório diário por e-mail; margens e preços anteriores; busca avançada; Excel/PDF | relatórios entregues por e-mail e em arquivo |
| **S13 · Expansão** (M8) | Decidir e começar a Fase 13 | **Escopo da Fase 13 definido pelo Adriano** → spec aprovada; primeiros conectores | spec `Aprovada` e primeira entrega |

Faixas de capacidade: S5–S8 são o **caminho crítico do MVP** (4 sprints, 2 deles dependem de terceiros: infraestrutura e jurídico). S9–S12 podem ser reordenadas conforme o cliente-piloto pedir.

---

## 5. O que preciso de você, por ordem de impacto

| # | Pedido | Destrava |
| --- | --- | --- |
| 1 | Provedores (VPS em São Paulo, S3 de produção, bucket de backup de outro provedor), domínio e logo | S6, MVP |
| 2 | **Planilha Excel** atual da agenda e **30+ casos de prazo** com o jurídico | S7, MVP |
| 3 | Contrato operador/controlador (LGPD) e política de retenção | S8, 1º cliente real |
| 4 | Decisão do Compras.gov.br (recomendo só conferência cruzada) e 50 editais da amostra | S8 |
| 5 | Chave da IA (cadastrada em Cadastros → IA) e 20 editais de veículos com gabarito | S9 |
| 6 | Contador: parâmetros tributários; jurídico: base de fontes, modelos de peça, empate/inexequibilidade | S10, S11 |
| 7 | Modelo oficial de proposta e papel timbrado | S10 |
| 8 | Escopo da Fase 13 | S13 |
| 9 | Destino do projeto Supabase antigo (pausar ou excluir) | limpeza/custo |

## 6. Riscos

| Risco | Efeito | Mitigação |
| --- | --- | --- |
| Construir mais antes de endurecer | Dívida de segurança cresce; vazamento entre empresas é o erro que não pode acontecer | S5 primeiro; nada de dado real antes do critério 1 do MVP |
| Regras de prazo não validadas | Prazo jurídico errado (erro proibido) | S7 com casos do jurídico; selo de validação visível na tela já existe |
| IA nunca testada com chave real | Qualidade desconhecida; custo imprevisto | Tudo desligado sem chave; limites diários por recurso; S9 mede antes de confiar |
| Dependência de poucas pessoas (Adriano, jurídico, contador) | Sprints parados esperando insumo | Pedir já os insumos da seção 5; sprints sem dependência (S5, S11 parcial) preenchem a espera |
| Disco local e dados da coleta | PNCP desligado para poupar disco | Religar só em produção (S6) |
| Ritmo de 138 commits em 5 dias sem revisão | Inconsistência entre docs e código | S5 inclui `auditor-fase` e atualização das specs |
