# Spec · Fase 05 · Agenda, gerenciamento de editais e prazos jurídicos

- **Status:** Aprovada em 2026-11-05 (instrução do Adriano: "continue a desenvolver, frontend primeiro, com calendários e tudo mais, para termos um MVP funcional o quanto antes", com as recomendações da seção 11). ⚖️ Os prazos seguem **não validados pelo jurídico** e o aceite (CA-5, CA-7) continua pendente
- **Onda:** 2 — MVP ("coração do MVP: substitui a planilha")
- **Autor:** Claude Code (2026-11-05) · **Aprovação:** Adriano Vale, 2026-11-05
- **Validação jurídica:** **pendente e bloqueante para o aceite** (regras de prazo da Lei 14.133 e da LC 123, contagem de dias úteis, 30+ casos de teste do jurídico VV)
- **Fontes:** Prompt Mestre Fase 05 (5.1 a 5.6); Plano, Fase 05; Fase 04 (`pub.editais`, `pub.edital_itens`, `pub.edital_versoes`, `pub.edital_eventos`, `priv.oportunidades`); Fase 03 (`checklist_documental`, `data_sessao` por parâmetro); ADR-014 (fila), ADR-017 (arquivos); `docs/threat-model.md` (T6, T1)

> Estado de partida: o dado público de licitações já existe e é coletado do PNCP (itens individualizados, retificações como versão, eventos `retificado` e `data_alterada`). `pub.editais.data_sessao` está **nula de propósito**: a fonte não informa a data da disputa e a Fase 04 não a deduz; esta fase decide de onde ela vem. O módulo `agenda` já existe na matriz de permissões. **Não existem** agenda, participação, feriados, regras de prazo nem cálculo de prazo.
>
> **Dependências externas (roadmap):** a planilha Excel atual da agenda (Operação VV) e a tabela de regras de prazo com 30+ casos de teste (jurídico VV). Sem elas o código pode ser feito e testado, mas o **aceite não fecha** (CA-5 e CA-7).

## 1. Escopo

**Entra:**

- **Acompanhamento do edital por empresa** (`priv.acompanhamentos`): a empresa decide acompanhar um edital; guarda a data/hora de abertura **confirmada**, a origem dessa data, cláusula do edital, portal, link da disputa, prazos fixados pelo próprio edital, responsável, prioridade e confiabilidade.
- **Participação por item** (`priv.participacoes`, empresa x item): status, responsável, prioridade e as três situações (documentação, proposta, jurídica); um edital com 8 itens aparece como 8 linhas.
- **Calendário de feriados** (`pub.feriados`) e **regras de prazo parametrizadas** (`pub.regras_prazo`, com artigo e estado de validação pelo jurídico).
- **Módulo `rules/prazos.py`** (código puro no worker): dias úteis por município do órgão, prioridade do prazo do edital sobre a lei, data interna recomendada (padrão D-2 úteis). A API **pede o cálculo por job**; nunca calcula em TypeScript.
- **Eventos da agenda** (`priv.agenda_eventos`) gerados ao cadastrar/atualizar o acompanhamento, com os 7 tipos da tabela 5.3, status, override manual com justificativa auditada e histórico imutável.
- **Controle de alterações**: a retificação do edital (Fase 04) gera aviso e diff; mudança na data de abertura recalcula todos os prazos e avisa os responsáveis.
- **Alertas** D-5, D-3, D-1 e no dia, com escalonamento ao gestor se não houver ação (notificação, push e e-mail).
- **Visualizações**: tabela (web), cards (celular), dia, semana, mês, por empresa, por responsável e consolidada.
- **Importação da planilha Excel** (mapeamento assistido, prévia, duplicidades, relatório) e **exportação Excel**.
- **Alerta de documento que vence antes da disputa** (RF-03.8 da Fase 03), alimentado pela data de abertura confirmada.

**Não entra (e onde fica):**

| Fica de fora | Onde fica |
| --- | --- |
| Elaboração das peças (esclarecimento, impugnação, recurso, contrarrazões) e prazos de resposta **gerados pela peça protocolada** | Fase 10 (aqui os eventos desses tipos existem e são registrados **à mão** pelo botão correspondente) |
| Atendimento técnico por IA, marca/modelo/versão propostos, preços e valor da proposta | Fases 06 e 07 (os campos aparecem na agenda como "A CONFIRMAR", marcados EM DESENVOLVIMENTO) |
| Propostas, declarações e habilitação; participação na disputa e resultado | Fases 08 e 09 |
| Sincronização com Google Calendar (OAuth) | Fase 13 (aqui: arquivo `.ics` por download, sem OAuth; pergunta 11) |
| Qualquer ação no portal (protocolar, propor, dar lance) | Nunca (regra 17) |

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-05.1 | Agenda central com visualizações diária, semanal, mensal, tabela, por empresa, por responsável e consolidada | Prompt 5.1 |
| RF-05.2 | Todos os campos de 5.2 representados (derivados de `pub.*`, do acompanhamento ou da participação); cada item de edital em linha própria | Prompt 5.2; Plano |
| RF-05.3 | Ao cadastrar ou atualizar um edital acompanhado, criar os eventos jurídicos de 5.3 com data-limite legal, data interna recomendada, horário-limite do portal (se houver), regra usada, responsável e status | Prompt 5.3 |
| RF-05.4 | Prazo fixado pelo edital prevalece sobre o padrão da lei, com a cláusula indicada | Prompt 5.3 |
| RF-05.5 | Cálculo em dias úteis com os feriados do local do órgão (nacionais, UF e municipais); sempre por código puro no worker com relógio injetável | Prompt 5.3; Plano |
| RF-05.6 | Regras de prazo como dado (`pub.regras_prazo`) com artigo, valor padrão, parametrização e estado de validação pelo jurídico | Prompt 5.3; Plano |
| RF-05.7 | Status do evento: Sugerido, Em elaboração, Em revisão, Aprovado, Protocolado, Respondido, Prazo perdido, Dispensado com justificativa | Prompt 5.3 |
| RF-05.8 | Override manual de data-limite e dispensa de evento exigem justificativa; ficam no histórico e na auditoria | Plano |
| RF-05.9 | Detectar mudança em data, hora, quantidade, valor, descritivo, documentos, prazos e status, com comparação entre versões | Prompt 5.5 |
| RF-05.10 | Mudança da data de abertura recalcula todos os prazos e avisa os responsáveis | Prompt 5.5 |
| RF-05.11 | Retificação que altere o conteúdo da proposta sinaliza a possível necessidade de reabrir o prazo de publicação (a decisão é humana) | Prompt 5.5 |
| RF-05.12 | Alertas: disputa próxima; alteração do edital; prazos de esclarecimento, impugnação, recurso e contrarrazões (D-5, D-3, D-1 e no dia); proposta e documentação pendentes; resposta da Administração publicada; escalonamento ao gestor sem ação | Prompt 5.6 |
| RF-05.13 | Importar a agenda atual em Excel: identificar colunas, preservar dados, verificar duplicidades, associar empresas, apontar inconsistências e gerar relatório; nunca alterar o arquivo original | Prompt 5.4 |
| RF-05.14 | Exportar a agenda em Excel sem perder campos e sem permitir injeção de fórmula | Prompt 5.x (critério); T3 |
| RF-05.15 | Cruzar o vencimento dos documentos com a data de abertura confirmada (alerta "vence antes da disputa") | Fase 03 RF-03.8 |
| RF-05.16 | Isolamento A x B em toda tabela e endpoint novos | AGENTS.md regra 13 |

## 3. Modelo de dados

Convenções: UUID v7; `snake_case`; datas com fuso (`timestamptz`) e dia-limite como `date` quando o prazo é por dia; `empresa_id` e RLS em tudo que é `priv`. `pub.*` só o worker escreve (SUPERADMIN cadastra feriado e regra pela API por função).

### `pub.feriados`

`id`, `data date`, `nome`, `tipo` (`feriado`, `ponto_facultativo`), `abrangencia` (`nacional`, `uf`, `municipio`), `uf` (nulo se nacional), `codigo_ibge` (só municipal), `origem` (`calculado`, `manual`), `created_by`. **Único** `(data, abrangencia, coalesce(uf,''), coalesce(codigo_ibge,''))`. Feriados nacionais e móveis (Carnaval, Sexta-feira Santa, Corpus Christi) são **calculados** por função pura e gravados; estaduais (PR, SC) e municipais são carga inicial revisável e cadastro manual. RLS: select a qualquer autenticado; escrita só SUPERADMIN (função).

### `pub.regras_prazo`

| Coluna | Tipo | Regra |
| --- | --- | --- |
| id | uuid | v7 |
| evento | text | `esclarecimento`, `impugnacao`, `resposta_administracao`, `intencao_recurso`, `razoes_recurso`, `contrarrazoes`, `regularizacao_fiscal_me_epp` |
| base | text | de onde conta: `abertura`, `peca_protocolada`, `sessao_resultado`, `intimacao`, `recurso_terceiro`, `declaracao_vencedora` |
| quantidade | int | `<A DEFINIR>` até o jurídico validar (padrão do Prompt: 3, 3, 3, imediata, 3, 3, 5) |
| unidade | text | `dias_uteis` ou `imediato` |
| sentido | text | `antes` ou `depois` da base |
| limite_superior | text | ex.: "último dia útil antes da abertura" (art. 164, parágrafo único) |
| artigo | text | norma e artigo exibidos ao usuário |
| prorrogavel | boolean | LC 123, art. 43, §1º |
| validada_por, validada_em | | nulos até o jurídico validar |
| vigente_de, vigente_ate | date | versionamento: regra nova não reescreve a antiga |

Evento calculado com regra **não validada** carrega o selo "⚖️ regra não validada pelo jurídico" (nunca some em silêncio).

### `priv.acompanhamentos` (empresa x edital)

`id`, `empresa_id`, `edital_id` (FK `pub.editais`), `responsavel_id`, `prioridade` (`baixa`, `normal`, `alta`, `urgente`), `status` (`acompanhando`, `em_elaboracao`, `aguardando_sessao`, `em_disputa`, `encerrado`, `desistiu`), `data_abertura timestamptz`, `abertura_origem` (`edital`, `portal`, `pncp_sugerida`, `manual`), `abertura_confirmada boolean`, `abertura_clausula text`, `portal`, `link_disputa`, `link_documentos`, `prazo_esclarecimento_edital timestamptz`, `prazo_impugnacao_edital timestamptz`, `clausula_prazos text`, `confiabilidade` (`alta`, `media`, `baixa`, `a_confirmar`), `observacoes`, `ultima_conferencia_em`, `edital_versao_vista int`, `created_at/updated_at/created_by/deleted_at`. **Único** `(empresa_id, edital_id) where deleted_at is null`.
**RLS:** select `core.has_permission(empresa_id, 'agenda', 'visualizar')`; insert `'agenda','cadastrar'`; update `'agenda','editar'`; delete nenhum (soft delete). A data de abertura **só é gravada por função** (que enfileira o recálculo) para nunca existir data sem prazos correspondentes.

### `priv.participacoes` (empresa x item)

`id`, `empresa_id`, `acompanhamento_id`, `item_id` (FK `pub.edital_itens`), `responsavel_id`, `prioridade`, `status` (`avaliando`, `vai_participar`, `nao_vai`, `proposta_enviada`, `em_disputa`, `arrematada`, `habilitacao`, `vencida`, `perdida`, `desclassificada`, `cancelada`), `situacao_documentacao`, `situacao_proposta`, `situacao_juridica` (cada uma: `a_confirmar`, `pendente`, `em_andamento`, `ok`, `nao_se_aplica`), `atendimento_tecnico` (texto livre até a Fase 06), `marca`, `modelo`, `versao`, `valor_unitario numeric(18,4)` e `valor_total numeric(18,4)` (preenchidos pela Fase 07; aqui só digitação), `pendencias text`, `observacoes`, `origem_oportunidade_id` (liga a `priv.oportunidades` quando veio da triagem). **Único** `(empresa_id, item_id) where deleted_at is null`. RLS igual ao acompanhamento. Quem marca "Tenho interesse" numa oportunidade (Fase 04) pode **promover** a participação em um clique.

### `priv.agenda_eventos`

`id`, `empresa_id`, `acompanhamento_id`, `tipo` (os 7 de `regras_prazo.evento` + `disputa`, `alteracao_edital`, `documento_vence`), `regra_id` (nulo se prazo do edital ou manual), `base_data timestamptz`, `data_limite_legal timestamptz`, `data_interna_recomendada timestamptz`, `horario_limite_portal time`, `origem_prazo` (`regra`, `edital`, `manual`), `clausula_edital`, `responsavel_id`, `status` (os 8 do Prompt), `justificativa` (obrigatória em manual/dispensa), `calculado_em`, `versao_calculo`, `regra_validada boolean`, `created_at/updated_at`. **Único** `(acompanhamento_id, tipo) where status <> 'cancelado_por_recalculo'`.
`priv.agenda_evento_historico` (só inserção): cada mudança de data, status, responsável ou override, com `quem`, `quando`, `antes`, `depois` e `motivo`.
**RLS:** select `agenda/visualizar`; update de `status/responsavel/justificativa` por `agenda/editar`; a **data-limite só é gravada** por função do worker (cálculo) ou pela função de override (que exige justificativa).

### `priv.agenda_alertas`

`evento_id`, `marco` (`D-5`, `D-3`, `D-1`, `D0`, `escalonado`), `enviado_em`, `canal`. **Único** `(evento_id, marco, usuario_id)`: não repete. Geração pelo worker.

### `priv.importacoes_agenda`

`id`, `empresa_id`, `arquivo_chave` (S3, quarentena da Fase 03), `nome_original`, `sha256`, `mapeamento jsonb` (coluna do Excel → campo), `status` (`enviada`, `lida`, `mapeada`, `previa`, `confirmada`, `falhou`), `resumo jsonb` (lidas, novas, duplicadas, inconsistentes), `relatorio_chave`, `created_by`. `priv.importacao_agenda_linhas`: `importacao_id`, `linha`, `dados jsonb` (valores originais **preservados**), `resultado` (`nova`, `duplicada`, `inconsistente`, `importada`), `motivo`.

### `priv.exportacoes_agenda`

`id`, `empresa_id`, `filtros jsonb`, `status`, `arquivo_chave`, `criado_por`, `created_at`. Arquivo gerado pelo worker; download por URL assinada de 60 s com auditoria.

### Jobs novos em `ops.jobs`

`calcular_prazos`, `reavaliar_acompanhamento`, `alertas_agenda`, `lida_importacao_agenda`, `confirmar_importacao_agenda`, `exportar_agenda`, `gerar_feriados`. Payload só com IDs.

## 4. Regras de negócio

1. **Acompanhar.** Qualquer usuário com `agenda/cadastrar` abre o acompanhamento de um edital público para a sua empresa (a partir de uma oportunidade ou de um edital). O acompanhamento nasce com a abertura `pncp_sugerida` (a data de **encerramento das propostas** do PNCP, quando houver) e `confiabilidade = a_confirmar`; **prazos calculados sobre data não confirmada são provisórios** e aparecem assim (⚖️ pergunta 3).
2. **Confirmar a abertura.** A pessoa confirma data, hora (com fuso do órgão), origem e cláusula; só então o evento deixa de ser provisório. Confirmar ou alterar a abertura chama a função do banco, que grava e enfileira `calcular_prazos` (chave `calc:{acompanhamento}:{versão}`).
3. **Cálculo (código puro, `rules/prazos.py`).** Entradas: data-base, regra, feriados do local do órgão, prazo do edital (se houver), "hoje" injetado. Saída: data-limite legal, data interna recomendada (padrão **2 dias úteis antes**, configurável por empresa), regra usada e artigo. Prazo do edital, se informado, **prevalece**, com a cláusula (RF-05.4). Dia útil = nem sábado/domingo nem feriado do local; ponto facultativo é tratado conforme pergunta 4. ⚖️ **VALIDAR JURÍDICO:** contagem (exclusão do dia do começo e inclusão do vencimento, dias úteis, contagem regressiva "até 3 dias úteis antes"), horário-limite do dia, tratamento de ponto facultativo, e os 7 prazos. Valores `<A DEFINIR>` até a tabela do jurídico chegar; o seed inicial usa os do Prompt Mestre marcados como **não validados**.
4. **Local do órgão.** Município do órgão (código IBGE, vindo da Fase 04) + UF + nacionais. Município sem feriados cadastrados usa só nacionais e estaduais e **avisa** ("feriados municipais não cadastrados"), nunca assume que não há.
5. **Eventos automáticos.** Ao confirmar a abertura criam-se **esclarecimento** e **impugnação** (e o evento `disputa`). Os demais (resposta, intenção, razões, contrarrazões, regularização ME/EPP) são criados quando a pessoa registra o fato gerador (botões "Peça protocolada", "Sessão realizada", "Intenção registrada", "Recurso de terceiro", "Vencedora com restrição"), até a Fase 10/09 automatizarem.
6. **Status.** Transições livres entre os estados abertos, exceto: `Prazo perdido` é posto pelo sistema quando a data-limite passa sem `Protocolado` ou `Respondido` (job diário), e só se desfaz com justificativa; `Dispensado` exige justificativa. Tudo vai ao histórico.
7. **Override.** Alterar a data-limite à mão exige justificativa (mínimo 10 caracteres), vira `origem_prazo = 'manual'`, fica no histórico e na auditoria, e o recálculo automático **não sobrescreve** um override (avisa que a base mudou).
8. **Retificação.** O evento `retificado`/`data_alterada` do edital (Fase 04) enfileira `reavaliar_acompanhamento`: compara a versão vista com a nova, registra o diff (data, hora, quantidade, valor, descritivo, documentos, prazos, status), notifica os responsáveis e, se mudou a data de encerramento das propostas ou a abertura confirmada, marca o acompanhamento "abertura a reconfirmar" e recalcula os prazos provisórios. Mudança no objeto, itens ou descrição gera o aviso "a retificação altera o conteúdo da proposta: avalie a necessidade de reabrir o prazo de publicação" (⚖️ decisão humana; o sistema nunca conclui).
9. **Alertas.** Job diário (e a cada hora para o dia do prazo) com relógio injetável: D-5, D-3, D-1 e no dia, por evento aberto, para o responsável e quem tem `agenda/visualizar`; **escalonamento**: se o evento segue em `Sugerido` em D-3 (ou sem mudança de status em D-1) avisa o gestor (ADMIN_EMPRESA e quem tem `agenda/aprovar`). Idempotente por `(evento, marco, usuário)`. Notificação interna + push já existem; e-mail pelo worker.
10. **Documento que vence antes da disputa.** Com a abertura confirmada, o worker cruza `checklist_documental` (Fase 03) com os documentos da empresa e cria `documento_vence` e notificação quando algum vence antes da sessão.
11. **Importação da planilha.** Aceita `.xlsx`; passa pela quarentena (ClamAV, tipo real, tamanho, SHA-256); lê só valores (sem fórmulas, sem macros); o usuário confirma o **mapeamento de colunas** (sugerido por nome e conteúdo) e vê a **prévia** (novas, duplicadas, inconsistentes). Só a confirmação grava. Chave de duplicidade: empresa + órgão + número do edital/processo + item. O arquivo original e os valores originais de cada linha são **preservados**; linha inconsistente é listada com o motivo, nunca descartada em silêncio. Empresa é associada por CNPJ ou razão social **só entre as empresas a que o usuário tem acesso**.
12. **Exportação.** `.xlsx` com todos os campos de 5.2 e os filtros da tela; célula que comece com `=`, `+`, `-`, `@` ou tabulação é gravada como texto com apóstrofo (injeção de fórmula, T3); máximo `<A DEFINIR: 20 mil>` linhas por arquivo.
13. **Visualizações.** Consolidada = soma das empresas que o usuário pode ver (RLS por empresa); por responsável = filtro; dia/semana/mês agrupam por data-limite e abertura em America/Sao_Paulo. Tabela no web, cards no celular.

## 5. Permissões

Módulo `agenda` (já existe). Gestor = ADMIN_EMPRESA (e quem receber `agenda/aprovar`).

| Operação / tela | SUPERADMIN | ADMIN_EMPRESA | OPERADOR | JURÍDICO | CLIENTE | Step-up |
| --- | --- | --- | --- | --- | --- | --- |
| Ver agenda, eventos, participações, diff | sim | `visualizar` | `visualizar` | `visualizar` | só se a empresa conceder | — |
| Acompanhar edital, criar/editar participação, confirmar abertura | sim | `cadastrar`/`editar` | `cadastrar`/`editar` | `editar` | não | — |
| Mudar status do evento, registrar fato gerador | sim | `editar` | `editar` | `editar` | não | — |
| Override de data-limite; dispensar evento; desfazer "Prazo perdido" | sim | `editar` + justificativa | `editar` + justificativa | `editar` + justificativa | não | não (pergunta 10) |
| Importar planilha (prévia e confirmar) | sim | `cadastrar` | `cadastrar` | — | não | — |
| Exportar | sim | `exportar` | `exportar` | `exportar` | só se conceder | — |
| Cadastrar feriado (municipal) | sim | não | não | não | não | — |
| Validar regra de prazo (`validada_por`) | sim (registra o jurídico) | não | não | não | não | sim |
| Ver/baixar arquivo da importação ou exportação | sim | `visualizar`/`exportar` | idem | idem | só se conceder | — |

O front só esconde; a API (guard + RLS) decide.

## 6. Telas

| Tela | Rota | Estados | Comportamento em 360 px |
| --- | --- | --- | --- |
| Agenda (tabela web / cards celular; filtros por empresa, responsável, UF, órgão, status, período) | `/agenda` | carregando; vazio; erro; sem permissão; "prazo provisório"; "regra não validada" | cards com o próximo prazo em destaque; vencidos primeiro; filtros em folha inferior |
| Calendário (dia, semana, mês) | `/agenda/calendario` | idem | visão do dia e da semana em lista; mês em grade rolável |
| Acompanhamento do edital (abertura, prazos do edital, itens/participações, eventos, diff de versões, histórico) | `/agenda/editais/:id` | "abertura a confirmar"; "recalculando"; retificado desde a última conferência | abas rolantes; evento como cartão com ações |
| Evento (status, override com justificativa, dispensar, histórico) | modal em `/agenda/editais/:id` | erro de justificativa; prazo perdido | modal de largura total |
| Importar planilha (envio, mapeamento, prévia, relatório) | `/agenda/importar` | enviando; verificando arquivo; inconsistências listadas; sucesso | passos em coluna única |
| Exportar | botão em `/agenda` | gerando; pronto (link de 60 s); falha | — |
| Feriados e regras de prazo (SUPERADMIN) | `/plataforma/prazos` | regra não validada em destaque | tabela rolável |

Recurso incompleto aparece como **EM DESENVOLVIMENTO** (ex.: atendimento técnico, valores).

## 7. Jobs e integrações

| Job | Gatilho | Idempotência | Em caso de falha |
| --- | --- | --- | --- |
| `calcular_prazos` | abertura confirmada/alterada; feriado ou regra mudou; override removido | `calc:{acompanhamento}:{versão}`; regrava os eventos de forma atômica e registra no histórico só o que mudou | volta à fila; evento antigo permanece e marcado "recálculo pendente" |
| `reavaliar_acompanhamento` | `pub.edital_eventos` (`retificado`, `data_alterada`) de edital acompanhado | por `(acompanhamento, versão do edital)` | volta à fila; aviso de que a conferência está pendente |
| `alertas_agenda` | diário e de hora em hora no dia do prazo (relógio injetável) | `(evento, marco, usuário)` | falha registrada; nunca "alertou" sem ter enviado |
| `marcar_prazos_perdidos` | diário | por evento | alerta ao gestor |
| `lida_importacao_agenda`, `confirmar_importacao_agenda` | upload e confirmação | por `(importação, estado)` | importação `falhou` com motivo; nada é gravado até a confirmação |
| `exportar_agenda` | pedido do usuário | por `(exportação)` | `falhou` com motivo |
| `gerar_feriados` | ano novo e sob demanda | por `(ano, abrangência)` | alerta ao SUPERADMIN |

Integrações externas: **nenhuma nesta fase** (feriados calculados e cadastrados; sem API de terceiros; Google Calendar fica na Fase 13).

## 8. Ameaças

| Ameaça | Como esta fase é afetada | Controle | Teste |
| --- | --- | --- | --- |
| T6 | Prazo calculado errado ou perdido sem aviso; data de abertura errada | Código puro com regra versionada e artigo; prazo do edital prevalece; provisório visível; override exige justificativa e vai ao histórico; alerta com escalonamento; "Prazo perdido" automático | pytest com **30+ casos do jurídico** (feriados, fim de semana, ponte, município); pgTAP do histórico imutável; pytest do alerta com relógio simulado |
| T1 / T2 | Agenda, participações, eventos e importação são dado de empresa | RLS por empresa em todo `priv.*`; consolidada = só empresas do usuário; importação associa só a empresas acessíveis; worker valida o `empresa_id` do job | pgTAP A x B em cada tabela; e2e A x B em cada endpoint |
| T13 (nova) | **Recálculo apaga ou sobrescreve decisão humana** (override, status) | Override não é sobrescrito; recálculo só altera o que a regra produz e registra o antes/depois | pytest e pgTAP do histórico |
| T14 (nova) | **Planilha hostil** (fórmulas, macros, `.xlsm` renomeado, zip bomb, milhares de linhas) | Quarentena + ClamAV + tipo real; só valores; limites de tamanho/linhas/tempo; nada grava antes da confirmação | pytest com XLSX hostil e `.xlsm` |
| T15 (nova) | **Injeção de fórmula na exportação** (`=cmd`, `@SUM`) | Prefixar texto perigoso; testar abrindo o arquivo gerado como texto | pytest do exportador |
| T16 (nova) | **Fuso e virada de dia** (UTC x Brasília; horário-limite) | Tudo em `timestamptz`; regra de dia em America/Sao_Paulo; fuso do órgão parametrizado; testes em 23h59 e 00h01 | pytest com datas de borda |

As entradas T13 a T16 são propostas para `docs/threat-model.md` na entrega da fase.

## 9. Critérios de aceite

| # | Critério | Origem | Como será comprovado |
| --- | --- | --- | --- |
| CA-1 | Cada item de edital aparece em linha própria na agenda e nas participações | Prompt 5 | teste e2e com edital de 8 itens |
| CA-2 | Filtros funcionam por empresa e demais campos | Prompt 5 | e2e dos filtros + print |
| CA-3 | Mudança de data de abertura é registrada e recalcula todos os prazos | Prompt 5 | pytest e e2e: histórico com antes/depois |
| CA-4 | Override e dispensa exigem justificativa e ficam auditados; recálculo não os sobrescreve | Plano | pgTAP + pytest |
| CA-5 | **Prazos conferem com 30+ casos do jurídico**, incluindo feriados e fins de semana | Prompt 5; Plano | `test_prazos.py` com a tabela do jurídico. **PENDENTE até o jurídico entregar**; hoje só casos técnicos marcados "não jurídicos" |
| CA-6 | Alertas disparam nas datas certas, uma vez, com escalonamento | Prompt 5.6 | pytest com relógio simulado |
| CA-7 | **Importação da planilha real sem perda** | Prompt 5.4; Plano | importação da planilha da operação e relatório. **PENDENTE até a planilha chegar**; até lá, planilha sintética |
| CA-8 | Exportação mantém a integridade e bloqueia fórmula | Prompt 5 | pytest do exportador + abertura do arquivo |
| CA-9 | Retificação gera diff, aviso e recálculo | Prompt 5.5 | e2e com fixture da Fase 04 retificada |
| CA-10 | Documento que vence antes da disputa gera alerta | Fase 03 RF-03.8 | pytest com o checklist da Fase 03 |
| CA-11 | Isolamento A x B | regra 13; T1 | pgTAP em todas as tabelas `priv` novas + e2e dos endpoints |
| CA-12 | Regra não validada aparece sinalizada em toda tela de prazo | T6 | teste de interface |

## 10. Plano de blocos (modo rápido: direto no `main`, sem PR)

1. **Banco:** `pub.feriados`, `pub.regras_prazo` (seed do Prompt, não validado), `priv.acompanhamentos`, `priv.participacoes`, `priv.agenda_eventos` e histórico, `priv.agenda_alertas`, importações e exportações, RLS, funções de escrita e pgTAP A x B.
2. **Feriados:** cálculo puro (Páscoa, móveis), seed nacional/PR/SC, cadastro municipal.
3. **`rules/prazos.py`:** testes primeiro (casos técnicos), dias úteis, prioridade do edital, data interna.
4. **Jobs de cálculo e reavaliação:** `calcular_prazos`, `reavaliar_acompanhamento`, diff com a Fase 04, histórico.
5. **Alertas:** `alertas_agenda`, escalonamento, "Prazo perdido", cruzamento de documentos.
6. **API e telas:** agenda (tabela/cards), acompanhamento, eventos, visualizações dia/semana/mês.
7. **Importação e exportação** Excel.
8. **`.ics`** por download (pergunta 11) e ajustes finais.

## 11. Perguntas abertas

1. **Planilha atual.** Ainda não foi entregue. Opções: (a) começar já com o modelo dos 40 campos do Prompt e um importador de **mapeamento assistido** genérico, ajustando quando a planilha chegar; (b) esperar a planilha. *Recomendação:* (a), porque o Plano já prevê mapeamento assistido e o risco é só de retrabalho de campos; CA-7 fica pendente.
2. **Tabela de regras de prazo e 30 casos (jurídico).** Pendente. *Recomendação:* implementar com o seed do Prompt Mestre **marcado como não validado**, selo visível em toda tela, e `validada_por` só preenchido por SUPERADMIN com step-up; sem os 30 casos, CA-5 não fecha e a fase **não é aceita**. Também preciso saber **quem no jurídico** valida e em que formato (planilha de casos: data-base, local, resultado esperado).
3. **Origem da data de abertura.** O PNCP traz a data de encerramento de propostas, não a da sessão. Opções: (a) sugerir a data do PNCP como provisória e exigir confirmação humana com cláusula; (b) deduzir a sessão = encerramento das propostas. *Recomendação:* (a), porque prazo legal sobre data deduzida é o erro que o produto não pode cometer.
4. **Contagem de prazo e dia útil.** ⚖️ Confirmar: exclui o dia do começo e inclui o do vencimento? "Até 3 dias úteis antes" conta regressivo a partir de qual hora? Ponto facultativo (ex.: segunda de Carnaval, véspera de Natal) é dia útil? Horário-limite do dia (fim do expediente do órgão ou 23h59)? *Recomendação provisória:* ponto facultativo **não** é dia útil quando o órgão o decretar (cadastrado como `ponto_facultativo` por órgão), e horário-limite = fim do dia do portal quando informado; o jurídico decide.
5. **Feriados.** Opções: (a) calcular nacionais/móveis em código e cadastrar estaduais (PR, SC) e municipais à mão; (b) consumir API de terceiros. *Recomendação:* (a), sem dependência externa; município sem cadastro mostra aviso. Quem cadastra os municipais dos órgãos mais frequentes (operação)?
6. **Fuso do órgão.** PR e SC são Brasília; outras UFs podem ter fuso diferente. *Recomendação:* guardar o fuso por UF (padrão America/Sao_Paulo) já na tabela de órgãos e usar nos cálculos.
7. **Granularidade.** Acompanhamento por **edital** e participação por **item**, como no Plano. Confirma? *Recomendação:* sim; eventos jurídicos são do edital, status de disputa do item.
8. **Data interna recomendada.** Padrão D-2 úteis. Configurável por empresa? *Recomendação:* sim, um parâmetro por empresa (padrão 2).
9. **Escalonamento ao gestor.** Quem é o gestor e quando escalar? *Recomendação:* ADMIN_EMPRESA e quem tiver `agenda/aprovar`; escalar quando o evento está em `Sugerido` em D-3 ou sem mudança de status em D-1; ambos `<A DEFINIR>` com a operação.
10. **Override e dispensa.** Exigir step-up (MFA) além da justificativa? *Recomendação:* só justificativa (mínimo 10 caracteres), histórico e auditoria; step-up apenas para **validar uma regra** (muda o cálculo de todas as empresas).
11. **Google Calendar.** Exige OAuth e verificação do app pelo Google. Opções: (a) adiar para a Fase 13 e entregar agora um `.ics` por download (sem OAuth, sem dado sensível no título); (b) OAuth já nesta fase. *Recomendação:* (a).
12. **Exportação e importação: limites.** `.xlsx` apenas; 10 MB e 20 mil linhas por arquivo? *Recomendação:* sim; `.xls`/`.csv` fora por enquanto.
13. **Retificação que altera a proposta.** O sistema só **avisa** ("avalie reabrir o prazo de publicação") e registra o diff; nunca conclui. ⚖️ Confirmar o texto do aviso e a regra de quais mudanças o disparam (objeto, itens, quantidades, especificação). *Recomendação:* qualquer mudança nesses campos dispara o aviso.
14. **Fatos geradores dos demais eventos.** Até as Fases 09 e 10, os eventos de resposta, intenção, razões, contrarrazões e regularização ME/EPP são criados **à mão** por botão. Aceita? *Recomendação:* sim, com o texto "EM DESENVOLVIMENTO: automático nas Fases 09 e 10".
15. **Campos que dependem de outras fases** (atendimento técnico, marca/modelo/versão, valores). *Recomendação:* aparecem na agenda como `A CONFIRMAR`, editáveis como texto, e as Fases 06 e 07 passam a preenchê-los.
16. **Retenção do histórico e dos arquivos de importação.** *Recomendação:* indefinida nesta fase (⚖️ LGPD com o jurídico), como na Fase 03.

## 12. Estado da implementação (2026-11-05)

- **Pronto e verificado no Docker (conta real, dados reais do PNCP):** banco (feriados, regras NÃO validadas, acompanhamentos, participações, eventos, histórico imutável; pgTAP 230), `rules/prazos.py` e `rules/feriados.py` (casos TÉCNICOS, não os do jurídico), job `calcular_prazos` (histórico, override preservado, prazo do edital), API (e2e A x B), telas: agenda com calendário mês/semana/dia, prazos em tabela e cartões, editais acompanhados, acompanhamento (abertura, prazos, itens/participações, histórico) e o botão "Acompanhar" em oportunidades e no edital.
- **Alertas e prazo perdido (pronto, 2026-11-05):** `worker/agenda_alertas.py` roda de hora em hora no consumidor leve (relógio injetável, `rules/alertas.py` puro). Um alerta por (evento, marco, usuário) em `priv.agenda_alertas`; em cada rodada vale só o marco mais urgente (worker parado não dispara rajada). Notificação interna + push para quem tem `agenda/visualizar` (exceto CLIENTE) e os responsáveis; e-mail só em D-1, no dia, escalonado e perdido (job `email_agenda`, payload só com ids). Escalonamento ao gestor (ADMIN_EMPRESA ou `agenda/aprovar`): "Sugerido" a ≤3 dias ou sem andamento a ≤1 dia. "Prazo perdido" automático (com histórico) só para prazo NÃO provisório e que não seja disputa. Tela: resumo no topo da Agenda (perdidos, vencem hoje, próximos 7 dias). pytest com banco (6 casos); o parâmetro D-N por empresa segue pendente.
- **Exportação .ics (pronta, 2026-11-05):** `GET /empresas/:e/agenda/calendario.ics` (mesmos filtros da lista, permissão `agenda/visualizar`, anexo `text/calendar`), gerado por `agenda/ics.ts` (puro, com teste: UTC, escape contra injeção de campos, dobra de linha em 75 octetos, TENTATIVE para provisório, alarme de 1 dia). É um instantâneo: não se atualiza sozinho quando o prazo é recalculado (assinatura por URL exigiria token e fica de fora). Botão "Baixar .ics" na Agenda.
- **Documentos que vencem antes da disputa (pronto, 2026-11-05):** `worker/agenda_documentos.py` + `rules/vencimentos.py` (puro). A cada hora (e ao recalcular prazos), para acompanhamentos com abertura CONFIRMADA e futura, cruza os documentos da empresa (última versão não bloqueada, com validade) e mantém UM evento `documento_vence` por edital: limite = fim do dia do primeiro vencimento, lista no aviso, notificação ao responsável e gestores quando nasce ou a lista muda. Renovou tudo: o evento vira "dispensado" com justificativa "[automático]" e reabre se voltar a vencer; decisão humana nunca é desfeita. Não há "prazo perdido" para este tipo. **Limite:** o checklist do edital (Fase 03/04) ainda não diz quais documentos o edital exige, então o cruzamento considera TODOS os documentos da empresa com validade; refinar quando o checklist por edital existir. 5 testes com banco + 3 da regra pura.
- **Exportação para planilha (pronta, 2026-11-05):** `GET /empresas/:e/agenda/eventos.csv` (mesmos filtros da lista; exige `agenda/exportar`), CSV UTF-8 com BOM, separador ";" para o Excel pt-BR, texto de edital protegido contra fórmula (`=`, `+`, `-`, `@`). Botão "Exportar planilha" na Agenda. Escolhi CSV para não adicionar dependência; .xlsx fica para quando houver o layout da planilha da operação. e2e: 404 para leitor sem `exportar` e para outra empresa.
- **Diff entre versões do edital (pronto, 2026-11-05):** `GET /editais/:id/comparar?de=&para=` (padrão: anterior x atual; `editais/visualizar`) compara o conteúdo das versões coletadas (`pesquisa/diff.ts`, puro, com testes): campos (datas pelo instante, dinheiro como string), itens adicionados/retirados/alterados e arquivos novos/retirados. Tela: "Ver o que mudou" em cada versão do edital e no aviso "Edital retificado" do acompanhamento (versão conferida → atual). Mudança em objeto, item novo/retirado, descrição, quantidade ou unidade mostra o aviso "avalie reabrir o prazo de publicação" (só avisa; **⚖️ texto e regra de disparo ainda pendentes de validação do jurídico**, pergunta 13). Só mostra fatos; conferido no navegador com dados reais (desktop e 360 px). 
- **Reavaliação ao retificar (pronta, 2026-11-05):** `worker/agenda_retificacao.py`, de hora em hora: para acompanhamentos abertos cujo edital ganhou versão desde a última notificação (`priv.acompanhamentos.retificacao_notificada_versao`), avisa responsável e gestores UMA vez dizendo quais campos mudaram (`campos_alterados` das versões); se mudou data de propostas/sessão marca `abertura_reconfirmar` (só uma pessoa desmarca, ao confirmar a abertura de novo) e enfileira o recálculo; se mudou objeto/itens acrescenta o aviso de reabrir prazo (⚖️ texto provisório). Tela: aviso "reconfirme a abertura" no acompanhamento e selo na lista. Migration 20261109100000; 4 testes com banco; pgTAP da marca.
- **Falta (próximos blocos):** importação de planilha (precisa do layout da planilha atual da operação), parâmetro D-N por empresa, cadastro de feriados municipais pela tela.
- **Pendente de fora do código:** os 30+ casos do jurídico (CA-5), a planilha atual (CA-7), validação das regras.
