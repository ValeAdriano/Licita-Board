# Spec · Fase 09 · Participação nas disputas e resultados (núcleo)

- **Status:** Aprovada em 2026-11-05 (instrução do Adriano: "siga desenvolvendo sem interrupções, uma fase após a outra"). Decisões abaixo são recomendações minhas, registradas para revisão.
- **Onda:** 6
- **Autor:** Claude Code (2026-11-05) · **Aprovação:** Adriano Vale, 2026-11-05
- **Validação:** ⚖️ o prazo da intenção de recurso vem da regra da agenda (Lei 14.133, art. 165, §1º, "imediato"), **ainda não validada pelo jurídico**.
- **Fontes:** Prompt Mestre Fase 09 (9.1 a 9.5); Fase 05 (participações, eventos, `priv.registrar_fato`); regra 17 do AGENTS.md.
- **Bloco 9.5 (§5):** `Aprovada` em 2026-11-08 (Adriano Vale; recomendações de §5.10 adotadas).

> O sistema **só registra**: nunca dá lance nem protocola nada em portal (regra 17). **Arrematação não é homologação**: são resultados diferentes.

## 1. Escopo

**Entra neste bloco:** os 20 status de participação do Prompt (9.1) mais os já existentes; o **resultado por item** (`priv.resultados_item`: valor inicial e final, classificação, melhor lance, vencedora com CNPJ/nome/marca-modelo, motivo da perda, situação de habilitação, resultado final e quando ocorreu); o **gatilho jurídico (9.3)**: perder, ser inabilitada ou desclassificada (ou não ficar em 1º) abre o evento **Intenção de recurso** na agenda, com prazo calculado pelo worker; o **histórico pesquisável (9.4)** por texto, órgão/município, marca/modelo (nossa e da vencedora), ano e resultado; tela de registro (item do acompanhamento) e aba **Resultados** na Agenda.

**Fica para os próximos blocos:** documentos posteriores (9.5: ata, decisões, adjudicação, homologação, contrato, empenhos; **rascunho em §5**), análise de viabilidade recursal (Fase 10.4, que consome o gatilho), alerta durante a sessão em tempo real, busca por portal e por valor, registro do comprovante de envio da proposta ao portal (rascunho na spec da Fase 08, §7).

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-09.1 | Status de participação com os 20 estados do Prompt, por empresa e item | 9.1 |
| RF-09.2 | Resultado por item com vencedora, valores, classificação, motivo e habilitação; valor vencedor cadastrável | 9.2 |
| RF-09.3 | Perda, inabilitação ou desclassificação exigem motivo; CNPJ da vencedora validado | 9.2 |
| RF-09.4 | Perda, inabilitação, desclassificação ou classificação > 1 abre a intenção de recurso na agenda | 9.3 |
| RF-09.5 | Histórico pesquisável sem confundir arrematada com homologada; ganhas = adjudicada, homologada ou contratada | 9.4 |
| RF-09.6 | Isolamento A x B; escrita só por função; dinheiro como texto decimal | regra 13/14 |

## 3. Critérios de aceite (deste bloco)

| ID | Critério | Prova |
| --- | --- | --- |
| CA-1 | Valor vencedor e resultado por item podem ser cadastrados e corrigidos (um por item) | pgTAP 290 + e2e |
| CA-2 | Arrematada não vira homologada; cada uma é um resultado próprio | pgTAP + e2e |
| CA-3 | Perda/inabilitação dispara o evento de intenção de recurso e o cálculo do prazo | pgTAP + e2e + conferido na stack real |
| CA-4 | A pesquisa histórica recupera processos por texto, órgão, marca e ano; `%` não vira curinga | e2e |
| CA-5 | Isolamento A x B | pgTAP + e2e |

## 4. Estado

- ✅ Status de participação e resultado por item, com motivos, validações, histórico e gatilho para intenção de recurso: `db/migrations/20261113100000_resultados.sql`, `apps/api/src/resultados/resultados.controller.ts`, `apps/web/src/features/resultados/RegistrarResultado.tsx`.
- ✅ Histórico pesquisável por texto e filtros e distinção entre arrematada/adjudicada/homologada: `apps/web/src/features/resultados/Historico.tsx`, `apps/api/src/resultados/resultados.controller.ts`.
- ✅ Valor é transportado como string decimal e escrita passa por função do banco: `apps/api/src/resultados/resultados.controller.ts`, `db/migrations/20261113100000_resultados.sql`.
- 🟡 Gatilho de recurso está implementado, mas o cálculo do prazo continua marcado não validado pelo jurídico: `apps/worker/src/worker/agenda.py`.
- ✅ **Documentos posteriores à disputa (9.5, §5):** `db/migrations/20261206100000_documentos_pos_disputa.sql` (`priv.documentos_posteriores`, 9 tipos de documento na pasta `licitacao`, `priv.registrar_documento_posterior`, `priv.registrar_habilitacao_apresentada`, `priv.remover_documento_posterior`), `db/tests/isolamento/priv_documentos_posteriores.test.sql`, `db/tests/500_documentos_pos_disputa.test.sql`, `apps/api/src/resultados/resultados.controller.ts` (linha do tempo unificada + 3 rotas de escrita), `apps/api/src/contratos/contratos.controller.ts` (leitura unificada na aba de anexos do contrato), `apps/api/test/resultados.e2e-spec.ts`, `apps/web/src/features/resultados/DocumentosPosteriores.tsx`, `apps/web/src/features/resultados/DocumentosPosteriores.test.tsx`, `apps/web/src/pages/Acompanhamento.tsx`, `apps/web/src/features/contratos/Anexos.tsx`.
- ❌ Alerta em tempo real e busca por portal/valor: pendentes para blocos futuros.
- ✅ Isolamento A x B por endpoint (Q-23, rodada 3): matriz nas 3 rotas `:empresa`, nos dois sentidos, com empresa da vítima e do invasor na URL; leitura e histórico sem dados alheios, escrita negada e resultado/participação/eventos/jobs intactos. `propostas.e2e-spec.ts` e `resultados.e2e-spec.ts`: 12/12 testes passaram juntos; pgTAP reexecutado no banco descartável.

- 2026-11-05 · núcleo pronto: migration `20261113100000` (status ampliados, `priv.resultados_item`, `priv.registrar_resultado`), API `apps/api/src/resultados`, tela (botão "Resultado" em cada item e aba "Resultados" na Agenda). Testes: pgTAP 290 e isolamento A x B, e2e (fluxo, gatilho, histórico, A x B). Conferido na stack real: registrar "perdida" criou o evento "Intenção de recurso" na agenda (selo ⚖️ regra não validada) e o histórico mostrou o resultado.

## 5. Bloco 9.5 · Documentos posteriores · **Aprovada**

- **Status deste bloco:** `Aprovada` em 2026-11-08 (Adriano Vale; recomendações de §5.10 adotadas).
- **Fontes:** Prompt Mestre 9.5 (ata de sessão; proposta final; documentos de habilitação próprios e da vencedora, quando públicos; recursos e contrarrazões; decisões; adjudicação; homologação; contrato; ata de registro de preços; empenhos), 9.4 (arrematação ≠ homologação), 10.4 a 10.7 (peças, recurso de terceiro, parecer), 11.1 e 11.2 (contratos, atas e empenhos), 13.5 (monitoramento automático, fora daqui); plano, Fase 09 ("Pasta de documentos posteriores (ata, adjudicação, homologação, empenhos)"); Fase 03 (repositório, ADR-017); Fase 08 §7 (bloco 8.7, comprovante de envio).

> **Princípios:** **uma pasta, nenhuma cópia.** O que já existe em outro módulo aparece por vínculo (proposta final, peças, recurso de terceiro, contrato, empenhos, anexos do contrato, checklist); só o que não tem casa ganha registro novo (`priv.documentos_posteriores`), sempre com o arquivo no repositório da Fase 03 (quarentena, antivírus, versões) ou como link público. **Anexar não muda resultado nem lança prazo sozinho:** arrematação continua diferente de homologação (o resultado é registrado pela pessoa na Fase 09) e nenhum prazo jurídico é suposto a partir de um documento (⚖️ perguntas 1 e 2). Texto de documento é dado (regra 16); nada aqui passa por IA.

### 5.1 Escopo

**Entra:**

- Aba **"Documentos posteriores"** por acompanhamento: linha do tempo de todos os documentos pós-sessão, por data do ato, com filtro por tipo e por item.
- **Registro novo** (arquivo ou link) para o que não existe em outro módulo: ata de sessão, decisões (de recurso, de impugnação, de habilitação, resposta a esclarecimento, outra), adjudicação, homologação, ata de registro de preços e contrato **enquanto não houver contrato cadastrado**, nota de empenho **enquanto não houver contrato**, documentos de habilitação da vencedora (quando públicos), arquivo de recurso/contrarrazões de terceiro, outro.
- **Vínculo sem cópia** com o que já existe: proposta final (`priv.propostas` `final`) e seus envios (bloco 8.7), peças da empresa (`priv.pecas`: esclarecimento, impugnação, recurso, contrarrazões), recursos de terceiros (`priv.recursos_terceiros`), parecer recursal (`priv.pareceres_recursais`), contrato/ata e empenhos (`priv.contratos`, `priv.empenhos`) e anexos do contrato (`priv.contrato_anexos`).
- **Documentos de habilitação próprios apresentados:** registro da "foto" das versões usadas (a partir do checklist da Fase 03), porque o checklist é recalculado todo dia e não guarda o que foi apresentado.
- **Pendências informativas:** resultado `homologada` sem documento de homologação, `adjudicada` sem adjudicação, `contratada` sem contrato cadastrado (este já existe na Fase 11: reaproveitar o banner).

**Não entra (e onde fica):**

| Item | Onde fica |
| --- | --- |
| Captura automática de atas, homologações, contratos e decisões no PNCP/portais | Fase 13.5 |
| Baixar o arquivo a partir do link informado | Pergunta 5 (recomendação: não neste bloco) |
| Criar contrato ou empenho estruturado a partir do documento | Fase 11 (cadastro existente, já pré-preenchido pelo acompanhamento) |
| Leitura de ata/decisão por IA (extrair datas, vencedora) | Não previsto; se vier, como sugestão com evidência |
| Lançar prazo de razões de recurso a partir da ata/intimação | Pergunta 1 (⚖️) |
| Busca textual nos documentos posteriores (12.4) | Item seguinte, depois deste bloco |

### 5.2 Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-09.7 | Aba "Documentos posteriores" por acompanhamento com todos os tipos do Prompt 9.5, em ordem de data do ato, filtráveis por tipo e item | 9.5 |
| RF-09.8 | Proposta final, peças, recursos de terceiros, parecer, contrato/ata, empenhos e anexos de contrato aparecem **por vínculo**, sem duplicar registro nem arquivo; cada grupo só aparece com a permissão do módulo de origem | 9.5, 11.1, 11.2, 10.x |
| RF-09.9 | Registro novo com: tipo, subtipo (decisões), data do ato (obrigatória), número, item (participação) ou "todos os itens", arquivo (Fase 03) **ou** link público `https`, CNPJ da concorrente (habilitação da vencedora), observação | 9.5 |
| RF-09.10 | Contrato, ata de registro de preços e empenho: se já existe contrato ligado ao acompanhamento, o arquivo vai para `priv.contrato_anexos` (função existente `anexar_documento_contrato`); se não existe, fica como documento posterior e aparece também na aba "Anexos" do contrato quando ele for cadastrado (leitura unificada, sem mover) | 9.5, 11.1 (reaproveitar) |
| RF-09.11 | "Foto" da habilitação própria: grava documento + versão liberada de cada exigência do checklist na data informada; não muda depois | 9.5, 3.5 |
| RF-09.12 | Anexar homologação/adjudicação **não** altera o resultado; a tela oferece "Atualizar resultado" que abre o registro da Fase 09 pré-preenchido, e a pessoa confirma | 9.4, critério "arrematação não é confundida com homologação" |
| RF-09.13 | Nenhum prazo é lançado automaticamente a partir de documento (pergunta 1) | regra 2, ⚖️ |
| RF-09.14 | Remover = soft delete com motivo, auditado; o arquivo continua no repositório da Fase 03 | 9.5, auditoria |
| RF-09.15 | Pendências informativas por resultado (homologada sem homologação etc.), sem bloquear nada | 9.5 |
| RF-09.16 | Isolamento A x B da tabela nova e das rotas; documentos da concorrente são dado privado da empresa que os anexou | regra 13, Prompt "Separação de dados" |

### 5.3 Modelo de dados

#### `priv.documentos_posteriores`

| Coluna | Tipo | Nulo | Regra |
| --- | --- | --- | --- |
| id | uuid | não | v7, PK |
| empresa_id | uuid | não | FK `core.empresas` |
| acompanhamento_id | uuid | não | FK `(…, empresa_id)` → `priv.acompanhamentos` |
| participacao_id | uuid | sim | FK `(…, empresa_id)` → `priv.participacoes`, do mesmo acompanhamento; nulo = todos os itens |
| tipo | text | não | `ata_sessao`, `habilitacao_propria`, `habilitacao_vencedora`, `decisao`, `adjudicacao`, `homologacao`, `ata_registro_precos`, `contrato`, `empenho`, `recurso_terceiro`, `contrarrazoes_terceiro`, `outro` |
| subtipo | text | sim | só com `decisao`: `recurso`, `impugnacao`, `esclarecimento`, `habilitacao`, `outra` (check) |
| data_ato | date | não | data de publicação/assinatura informada; não futura |
| numero | text | sim | ≤ 80 |
| documento_id | uuid | sim | FK `(…, empresa_id)` → `priv.documentos` |
| documento_versao_id | uuid | sim | FK `priv.documento_versoes`; versão fixada (obrigatória em `habilitacao_propria`) |
| link_publico | text | sim | `^https://[^\s]+$`, ≤ 500 |
| concorrente_cnpj | text | sim | `^[0-9A-Z]{14}$`, validado por `core.cnpj_valido`; só em `habilitacao_vencedora`/`recurso_terceiro`/`contrarrazoes_terceiro` |
| recurso_terceiro_id | uuid | sim | FK `(…, empresa_id)` → `priv.recursos_terceiros` (arquivo do recurso já inserido como texto) |
| observacao | text | sim | ≤ 1000 |
| created_at, updated_at, created_by | | não | padrão |
| deleted_at, removido_por, removido_motivo | | sim | soft delete; motivo 5 a 500 |

**Checks:** `documento_id is not null or link_publico is not null`; `tipo <> 'habilitacao_propria' or documento_versao_id is not null`; `subtipo is null or tipo = 'decisao'`.
**Índices:** `(acompanhamento_id, data_ato desc) where deleted_at is null`, `(empresa_id)`, `(documento_id)`. **Unicidade:** `(id, empresa_id)`; `(acompanhamento_id, tipo, documento_versao_id) where tipo = 'habilitacao_propria' and deleted_at is null` (a mesma versão não entra duas vezes na foto).

**Tipos de documento novos** na pasta `licitacao` (a mesma criada no bloco 8.7 da Fase 08; se este bloco vier antes, ele cria a pasta): `ata_sessao`, `decisao_administrativa`, `adjudicacao`, `homologacao`, `ata_registro_precos`, `contrato_assinado`, `nota_empenho`, `habilitacao_concorrente`, `recurso_terceiro_arquivo`; todos `exige_validade = false`. O mapeamento `tipo` → slug é fixo na função (não é escolha da pessoa).

**RLS:**

| Operação | Policy |
| --- | --- |
| select | `core.has_permission(empresa_id, 'agenda', 'visualizar')` (mesma regra de `priv.resultados_item`) |
| insert / update | nenhuma; só pelas funções abaixo |
| delete | nenhuma (soft delete por função) |

O arquivo em si continua protegido pela RLS de `priv.documentos` (`documentos/visualizar`), como em `priv.contrato_anexos`: sem essa permissão o vínculo aparece e o arquivo não. Auditoria `audit.registrar()` em insert/update (`enable always`). Teste de isolamento A x B em `db/tests/isolamento/`.

**Funções (security definer, `search_path = ''`):**

- `priv.registrar_documento_posterior(p_empresa, p_acomp, p_participacao, p_tipo, p_subtipo, p_data_ato, p_numero, p_documento, p_link, p_concorrente_cnpj, p_recurso_terceiro, p_observacao) returns uuid` — confere `agenda/editar` (e `documentos/visualizar` se houver arquivo); acompanhamento/participação/documento da empresa; tipo do documento compatível; última versão `liberado` (fixa a versão); **se `tipo in ('contrato','ata_registro_precos','empenho')` e existe contrato (não excluído) ligado ao acompanhamento, recusa com mensagem "anexe no contrato"** (a tela já desvia; ver RF-09.10).
- `priv.registrar_habilitacao_apresentada(p_empresa, p_acomp, p_data_ato) returns int` — confere `agenda/editar` e `documentos/visualizar`; para cada exigência aplicável do checklist com documento, grava uma linha `habilitacao_propria` com a versão liberada mais recente com validade na data (ou sem validade); devolve quantas gravou; não grava nada se não houver checklist.
- `priv.remover_documento_posterior(p_empresa, p_id, p_motivo)` — `agenda/editar`; soft delete.
- Leitura unificada: a API monta a linha do tempo consultando cada fonte dentro de `comContexto` (como a busca 12.4), só para os módulos que a pessoa vê.

### 5.4 Permissões (sugestão de padrão; a matriz é por vínculo)

| Operação | ADMIN_EMPRESA | OPERADOR | JURÍDICO | CLIENTE | Step-up |
| --- | --- | --- | --- | --- | --- |
| Ver a linha do tempo (`agenda/visualizar`; cada grupo com o módulo de origem: `propostas`, `juridico`, `contratos`) | sim | sim | sim | sim (leitura) | não |
| Baixar arquivo (`documentos/visualizar`) | sim | conforme vínculo | conforme vínculo | conforme vínculo | não |
| Anexar/remover (`agenda/editar` + `documentos/cadastrar` para o upload) | sim | sim | sim | não | não |
| Anexar documento de contrato existente (`contratos/editar`, função da Fase 11) | sim | conforme vínculo | conforme vínculo | não | não |

### 5.5 API

| Rota | Permissão | Corpo / parâmetros | Resposta |
| --- | --- | --- | --- |
| `GET /empresas/:empresa/acompanhamentos/:id/documentos-posteriores` | `agenda/visualizar` | `tipo?`, `participacao?` | `{ linhaDoTempo: [{ origem: 'registro'\|'proposta'\|'envio_proposta'\|'peca'\|'recurso_terceiro'\|'parecer'\|'contrato'\|'empenho'\|'anexo_contrato', id, tipo, subtipo, titulo, dataAto, numero, participacaoId, link, documento: { id, versaoId, nome, status } \| null, refRota }], grupos: { propostas: bool\|null, juridico: bool\|null, contratos: bool\|null }, pendencias: [{ codigo, participacaoId }], contratoId \| null }` — grupo `null` = sem permissão do módulo (a tela esconde; nunca lista vazia enganosa) |
| `POST /empresas/:empresa/acompanhamentos/:id/documentos-posteriores` | `agenda/editar` | `{ tipo, subtipo?, dataAto (AAAA-MM-DD), numero?, participacaoId?, documentoId?, link?, concorrenteCnpj?, recursoTerceiroId?, observacao? }` | `201 { id }`; `400` validação (sem arquivo nem link, tipo/subtipo, CNPJ, data futura, documento não liberado, "anexe no contrato"); `404` recurso de outra empresa |
| `POST /empresas/:empresa/acompanhamentos/:id/habilitacao-apresentada` | `agenda/editar` | `{ dataAto }` | `201 { gravados }`; `400` sem checklist |
| `POST /empresas/:empresa/documentos-posteriores/:id/remover` | `agenda/editar` | `{ motivo }` | `204`; `404` |

Upload e download pelas rotas existentes da Fase 03. Contrato existente: a tela chama a rota de anexos da Fase 11.

### 5.6 Telas

| Tela | Rota | Estados | 360 px |
| --- | --- | --- | --- |
| Documentos posteriores (aba do acompanhamento) | `/agenda/acompanhamentos/:id/documentos` | carregando; vazio ("nenhum documento posterior; anexe a ata da sessão quando sair"); erro; sem permissão; grupos sem permissão ocultos; pendências em amarelo ("homologada sem documento de homologação") com atalho "Anexar"; homologação/adjudicação anexada com atalho "Atualizar resultado" | linha do tempo em cartões (tipo, data, número, item, origem); filtro de tipo num seletor; botão "Anexar documento" fixo no rodapé |
| Anexar documento (folha) | mesma rota | escolher tipo → (se contrato/ata/empenho e há contrato: aviso "vai para os anexos do contrato" e segue na rota da Fase 11) → data, número, item, arquivo **ou** link → envio com quarentena e verificação (padrão `EnviarAnexo.tsx`, retomada por `sessionStorage`) → recusado (motivo) ou salvo | campos em coluna única; teclado numérico para CNPJ |
| Registrar habilitação apresentada | botão na aba | confirmação com a lista do que será gravado; "sem checklist" | lista rolável |
| Aba "Anexos" do contrato (Fase 11) | `/contratos/:id` | passa a mostrar também os documentos posteriores de tipo contrato/ata/empenho do acompanhamento ligado, marcados "do acompanhamento" | sem mudança de layout |

### 5.7 Critérios de aceite

| # | Critério | Como será comprovado |
| --- | --- | --- |
| CA-6 | Cada tipo do Prompt 9.5 pode ser registrado ou aparece por vínculo na linha do tempo | e2e com um acompanhamento fictício completo |
| CA-7 | Nada é duplicado: proposta, peças, recurso de terceiro, contrato e empenhos aparecem por vínculo; o arquivo não é copiado | e2e + pgTAP (sem linha nova nas tabelas de origem) |
| CA-8 | Anexar homologação não muda `priv.resultados_item` nem o status da participação | pgTAP |
| CA-9 | Nenhum evento de agenda é criado ao anexar ata/decisão | pgTAP |
| CA-10 | Com contrato ligado, registrar contrato/ata/empenho como documento posterior é recusado; sem contrato, aparece depois na aba do contrato | pgTAP + e2e |
| CA-11 | Foto da habilitação fixa a versão: nova versão do documento depois não altera a foto | pgTAP |
| CA-12 | Sem `documentos/visualizar` o vínculo aparece sem arquivo; sem `contratos/visualizar` o grupo vem `null` | e2e |
| CA-13 | A x B: B não lista, não anexa em acompanhamento de A, não remove e não baixa (404) | pgTAP de isolamento + e2e |

### 5.8 Ameaças (proposta para `docs/threat-model.md`)

| Ameaça | Controle | Teste |
| --- | --- | --- |
| **T1** · documentos e decisões de uma empresa (incluindo da concorrente) vistos por outra | RLS `agenda` + `documentos`, 404 sem revelar | CA-13 |
| **T3** · arquivo malicioso (ata/decisão em PDF de terceiro) | fluxo da Fase 03 (quarentena, antivírus, tipo real); nunca renderizado no servidor; sem IA | testes da Fase 03 |
| **T6** · confundir arrematação com homologação por anexar documento | anexar não altera resultado (CA-8); atualização é humana | CA-8 |
| **T13 (nova, a mesma do bloco 7.5 da Fase 07) · LGPD** · documentos de habilitação da concorrente com dados pessoais de sócios/responsáveis | só "quando públicos" (aviso na tela); dado privado da empresa; retenção ⚖️ pergunta 4 | revisão |
| **T15 (nova)** · link público usado para phishing/rastreamento | só `https`; aberto em nova aba com `rel="noopener noreferrer"`; o servidor não segue o link | revisão + e2e |

### 5.9 Plano de entregas

1. Migration (`priv.documentos_posteriores`, tipos e pasta `licitacao`, 3 funções) + pgTAP + isolamento A x B.
2. API (linha do tempo unificada + 3 rotas) + e2e A x B.
3. Tela (aba, folha de anexar, habilitação apresentada) + leitura na aba de anexos do contrato.

### 5.10 Decisões adotadas (2026-11-08)

1. ⚖️ **Ata/decisão como base de prazo:** **(a) não lança prazo sozinho neste bloco** (o jurídico lança o fato como hoje; a sugestão pré-preenchida (b) entra quando o jurídico validar quais documentos contam como intimação).
2. **Homologação anexada atualiza o resultado:** **(a) só sugere** (botão "Atualizar resultado" pré-preenchido; decisão humana, preservando que arrematação ≠ homologação).
3. ⚖️ **Empenho sem contrato:** **(a) manter como documento posterior** até definição do jurídico/Adriano sobre quando a nota de empenho substitui o instrumento contratual.
4. ⚖️ **Documentos da concorrente (LGPD):** **(a) arquivo ou link com aviso "somente documentos públicos"**, seguindo a política geral de retenção do acompanhamento.
5. **Baixar o arquivo a partir do link pelo worker:** **(a) não neste bloco** (só guarda o link `https`; captura automática fica para a Fase 13.5).
6. **Um documento para vários itens:** **(a) um item (`participacao_id`) ou todos os itens (`null`)**.
7. **Foto da habilitação:** **botão manual (`Registrar habilitação apresentada`)** neste bloco e atalho opcional ao fim do registro de envio (8.7), sem automatismo.
