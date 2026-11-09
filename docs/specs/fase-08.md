# Spec · Fase 08 · Propostas (declarações e habilitação ficam para os próximos blocos)

- **Status:** Aprovada em 2026-11-05 (instrução do Adriano: "siga desenvolvendo sem interrupções, uma fase após a outra"). Decisões abaixo são recomendações minhas, registradas para revisão.
- **Onda:** 5
- **Autor:** Claude Code (2026-11-05) · **Aprovação:** Adriano Vale, 2026-11-05
- **Validação:** modelos oficiais dos editais e papel timbrado da empresa (Operação VV) **pendentes**; texto padrão da proposta e das declarações ⚖️ **pendente do jurídico**.
- **Fontes:** Prompt Mestre Fase 08 (8.1 a 8.7); Fase 02 (representantes e poderes, `core.signatario_valido`); Fase 03 (validade de documentos); Fase 05 (acompanhamento, abertura); Fase 06 (análise técnica aprovada); Fase 07 (preço aprovado e `rules/extenso.py`).
- **Bloco 8.7 (§7):** `Aprovada` em 2026-11-08 (Adriano Vale; recomendações de §7.10 adotadas).

> **Princípios:** a proposta só nasce de **preço aprovado** (Fase 07); validações são código puro e **qualquer divergência bloqueia**; o documento final recebe **hash e fica bloqueado** (nova alteração = nova versão); o sistema **nunca envia ao portal** (regra 17): a pessoa autorizada baixa o arquivo e registra o comprovante.

## 1. Escopo

**Entra neste bloco:**

- **Proposta por acompanhamento** (`priv.propostas`), versionada (v1, v2...), com tipo `inicial` ou `final`, representante, validade da proposta, prazo de entrega, garantia e condições comerciais. O conteúdo (itens, quantidades, preços unitários e totais) é um **instantâneo** dos itens com preço aprovado; custos e margens **nunca** entram na proposta.
- **Validação automática (8.6)** em `rules/proposta.py`: CNPJ da empresa, representante com poder `assinar_proposta` válido na data da sessão (procuração vigente), número do edital, quantidades contra o edital, total = quantidade × unitário e soma dos totais, preço do rascunho igual ao preço aprovado atual, marca/modelo com **análise técnica aprovada**, documentos de habilitação válidos na data da sessão. Cada divergência diz o que é e se **bloqueia**.
- **Fluxo (8.7):** `rascunho → conferência → aprovada → final`. Conferência e aprovação por pessoas diferentes quando possível (aprovar exige `propostas/aprovar`). O `final` gera o **.docx** (sem dependência nova), com valor por extenso (`rules/extenso.py`), grava no armazenamento, calcula **SHA-256** e **bloqueia** a versão. Mudar algo = nova versão.
- **Tela:** versões da proposta, itens, validação (bloqueios em vermelho), ações do fluxo e download.

**Fica para os próximos blocos:**

| Item | Por quê |
| --- | --- |
| PDF (8.2) | Exige LibreOffice na imagem do worker (peso e custo de imagem): decisão do Adriano. |
| Modelo oficial do edital e papel timbrado (8.3, 8.1) | Exige os modelos reais (Operação VV) e `docxtpl`; hoje o documento usa um modelo padrão simples. |
| Declarações (8.4) e checklist (8.5) | Dependem de identificar as declarações por edital (texto oficial/anexos). |
| Registro do comprovante de envio ao portal (8.7) | Entra com a Fase 09. **Rascunho em §7.** |

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-08.1 | Criar proposta a partir de itens com preço aprovado; instantâneo sem custos nem margens | 8.1 |
| RF-08.2 | Validação automática com divergências bloqueantes ou de aviso, gravada na proposta | 8.6 |
| RF-08.3 | Fluxo rascunho → conferência → aprovada → final, com quem e quando; permissão por etapa | 8.7 |
| RF-08.4 | Documento final com valor por extenso, SHA-256 e bloqueio; alteração cria versão nova, as anteriores ficam | 8.2, 8.7 |
| RF-08.5 | Download pelo próprio sistema (URL temporária, permissão e auditoria); envio ao portal é humano | 8.7, regra 17 |
| RF-08.6 | Isolamento A x B e permissões do módulo `propostas` | regra 13 |

## 3. Dados e permissões

- `priv.propostas` (instantâneo em `conteudo jsonb`, `validacao jsonb`, `arquivo_chave`, `arquivo_sha256`, versão, status, quem/quando em cada etapa). Leitura com `propostas/visualizar`; criar/revalidar com `propostas/cadastrar`; conferir com `propostas/editar`; aprovar e gerar o final com `propostas/aprovar`. Gravação só por função; versão `final` imutável por gatilho.
- Dinheiro como `numeric(18,4)` / texto decimal; nada de `float`.

## 4. Critérios de aceite (deste bloco)

| ID | Critério | Prova |
| --- | --- | --- |
| CA-1 | Cada divergência da 8.6 bloqueia o avanço do fluxo e aparece na tela | pytest das regras + pgTAP |
| CA-2 | Documento final com extenso correto, hash gravado e versão bloqueada (update recusado) | pytest + pgTAP |
| CA-3 | Proposta só de preço aprovado; preço mudou depois = divergência bloqueante | pytest + e2e |
| CA-4 | Isolamento A x B de proposta e download | pgTAP + e2e |
| CA-5 | Modelo oficial do edital e papel timbrado preservados | **pendente** (modelos reais) |

## 5. Perguntas abertas (recomendação minha entre parênteses)

1. PDF: instalar LibreOffice na imagem do worker (custo de imagem) ou aceitar só Word por enquanto? (instalar quando for para produção.)
2. ⚖️ Texto-padrão da proposta e cláusulas obrigatórias por modalidade. (jurídico entrega o modelo; o código só preenche campos.)
3. Quem pode conferir e quem pode aprovar? (conferir: `propostas/editar`; aprovar: `propostas/aprovar`, idealmente outra pessoa.)

## 6. Estado

### Conferência item a item (2026-11-07)

- ✅ Propostas versionadas, validação, aprovação, documento final imutável com hash e download: `apps/api/src/propostas/propostas.controller.ts`, `apps/worker/src/worker/proposta.py`, `apps/web/src/features/propostas/Propostas.tsx`.
- ✅ Geração DOCX, PDF e valores por extenso: `apps/worker/src/worker/docx.py`, `apps/worker/src/worker/pdf.py`, `apps/worker/src/worker/rules/extenso.py`.
- ❌ Modelo oficial do edital e papel timbrado: não localizados em `apps/worker/src/worker` nem `apps/web/src/features/propostas`.
- ❌ Declarações (8.4) e checklist (8.5) ainda não aparecem como campos/fluxo da proposta em `apps/api/src/propostas` ou `apps/web/src/features/propostas`.
- ✅ **Q-12 (8.7, 2026-11-08):** Registro do comprovante de envio ao portal (`priv.proposta_envios`, pasta `licitacao` e tipo `comprovante_envio_proposta` em `pub.tipos_documento`, funções `priv.registrar_envio_proposta` e `priv.anular_envio_proposta`, rotas `GET/POST /empresas/:empresa/propostas/:id/envios` e `POST /empresas/:empresa/proposta-envios/:id/anular`, componente `EnvioPortal` na proposta final e selo no acompanhamento; envio segue sempre humano, regra 17).
- 🟡 Texto-padrão da proposta depende de validação do jurídico.
- ✅ Isolamento A x B por endpoint (Q-23, rodada 3): matriz nas 10 rotas `:empresa`, nos dois sentidos, com empresa da vítima e do invasor na URL; recursos e jobs intactos, download DOCX/PDF sem URL para invasor e aprovação com step-up próprio válido. `propostas.e2e-spec.ts` e `resultados.e2e-spec.ts`: 12/12 testes passaram juntos; pgTAP reexecutado no banco descartável. Conferir/devolver/aprovar com empresa própria e ID alheio retornam 400 idêntico ao de ID inexistente; com empresa da vítima retornam 404.
- ✅ **Q-37 (2026-11-08):** `conferir_proposta`, `devolver_proposta` e `aprovar_proposta` dão `no_data_found` (P0002 → 404) para proposta ausente ou de outra empresa (migration `20261202100000_fluxo_codigos_restantes`, logo depois da permissão e antes do step-up); estado inválido segue `22023` (400). A consulta prévia `qProposta` saiu de `propostas.controller.ts`: o banco decide. Testado: pgTAP `470_fluxo_codigos_restantes` e e2e inteiro (matriz A x B com os mesmos 404).

- 2026-11-05 · spec aprovada; implementação em blocos (regras puras → banco → worker → API → tela).
- **Núcleo pronto (2026-11-05):** `rules/extenso.py` (valor por extenso, 100%), `rules/proposta.py` (validação 8.6, 100%), `worker/docx.py` (.docx só com a biblioteca padrão, 100%), migration `20261112100000` (`priv.propostas`: versões, fluxo, final imutável por gatilho, SHA-256), job `gerar_proposta` (`worker/proposta.py`), API `apps/api/src/propostas` (criar, dados, validar, conferir, devolver, aprovar, nova versão, download com URL de 60 s) e tela `/agenda/acompanhamentos/:id/proposta` (botão "Propostas" no acompanhamento). Testes: pytest (extenso, validação, docx, 5 do job com banco), pgTAP 280 e isolamento A x B, e2e (fluxo, imutabilidade, A x B). **Conferido ponta a ponta com a stack real:** divergências reais apareceram (representante, sessão não confirmada, quantidade, produto), foram resolvidas, o worker gerou o .docx no armazenamento, o SHA-256 gravado conferiu com o arquivo baixado e o texto tinha o extenso correto.
- **PDF pronto (2026-11-05, decisão do Adriano):** LibreOffice (`libreoffice-writer`) na imagem do worker; `worker/pdf.py` converte o .docx final em PDF (processo filho sem shell, perfil temporário, limite de 120 s); o PDF tem SHA-256 próprio (`arquivo_pdf_*`, migration `20261114100000`). A final continua imutável: o único UPDATE permitido depois dela é gravar o PDF uma vez. Se a conversão falhar a final vale sem PDF e dá para pedir depois (`POST …/propostas/:id/pdf`). Download `{formato: 'docx'|'pdf'}`. Conferido na stack real: PDF de 1 página gerado, hash do arquivo baixado igual ao gravado. **Custo:** a imagem do worker cresceu (~500 MB).
- **Falta na Fase 08:** modelo oficial do edital e papel timbrado (precisam dos modelos reais), declarações (8.4) e checklist (8.5) na proposta, registro do comprovante de envio ao portal (com a Fase 09). ⚖️ texto-padrão da proposta pendente do jurídico.

## 7. Bloco 8.7 · Registro do comprovante de envio da proposta ao portal · **Aprovada**

- **Status deste bloco:** `Aprovada` em 2026-11-08 (Adriano Vale; recomendações de §7.10 adotadas).
- **Fontes:** Prompt Mestre 8.7 ("O envio ao portal é sempre feito por pessoa autorizada, que registra o comprovante"), 9.1 (status "Proposta cadastrada"), 10.1 e 10.7 (mesmo padrão do protocolo humano das peças); plano, Fase 08 ("Registro manual de envio ao portal com upload do comprovante"); Fase 03 (repositório documental, quarentena e antivírus, ADR-017); regra 17.

> **Princípio (regra 17):** o sistema **nunca** envia proposta, protocola nem dá lance; não guarda credencial de portal e não abre o portal por automação. A pessoa autorizada envia no portal **fora do sistema** e depois **registra** aqui o fato e o comprovante. O registro é uma declaração humana, auditada e imutável; correção = anular com motivo e registrar de novo.

### 7.1 Escopo

**Entra:**

- Registro do envio de uma versão **`final`** da proposta (inicial ou final pós-disputa): data e hora do envio, portal, identificador/recibo do portal, formato enviado, comprovante (arquivo pelo repositório da Fase 03) e observação.
- O comprovante passa pelo fluxo existente (quarentena → antivírus → tipo real → SHA-256 → liberado); o registro só se completa com a versão do arquivo **liberada** (mesmo padrão do anexo de contrato, Q-24).
- Histórico de envios por proposta (pode haver reenvio/substituição dentro do prazo do portal); anulação com motivo.
- Efeito na agenda: os itens da proposta passam a "Proposta cadastrada" (sem regredir status mais avançado).
- Avisos (não bloqueiam): envio informado depois do encerramento das propostas; versão registrada não é a última `final`; comprovante pendente/recusado.

**Não entra (e onde fica):**

| Item | Onde fica |
| --- | --- |
| Envio automático, robô de portal, credencial de portal | Nunca (regra 17, T4) |
| Leitura do comprovante por IA (conferir número/data) | Não previsto; se vier, como sugestão (Fase 13) |
| Comprovante de protocolo de peça jurídica | Já existe (`priv.protocolar_peca`, Fase 10); a pergunta 7 trata de unificar o arquivo |
| Declarações (8.4) e lances | Outros blocos; lance nunca |

### 7.2 Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-08.7 | Registrar envio só de proposta com status `final` (documento com hash), da própria empresa | 8.7 |
| RF-08.8 | Campos: data/hora do envio (obrigatória, não futura), portal (pré-preenchido do acompanhamento), identificador do portal, formato (`docx`, `pdf`, `outro`), comprovante (arquivo obrigatório, pergunta 1), observação | 8.7, plano |
| RF-08.9 | O registro guarda a versão exata da proposta e o SHA-256 do arquivo nosso daquela versão (docx ou pdf, conforme o formato) e a versão exata do comprovante | 8.7 (hash), auditoria |
| RF-08.10 | Registro imutável; anular exige motivo (≥ 10 caracteres), fica no histórico; registrar de novo cria outro | 8.7, T6 |
| RF-08.11 | Registrar muda as participações dos itens da proposta para `proposta_cadastrada`, só se o status atual for anterior (`avaliando`, `aguardando_analise`, `vai_participar`, `proposta_preparada`); anular não desfaz status | 9.1 |
| RF-08.12 | Avisos não bloqueantes: envio após `data_encerramento_propostas`/abertura do acompanhamento; versão não é a última final; comprovante em quarentena ou bloqueado | 8.6 (espírito), T6 |
| RF-08.13 | Nenhuma rota, job ou integração envia algo a portal; a tela diz isso explicitamente | regra 17 |
| RF-08.14 | Isolamento A x B (tabela e rotas) e permissões por ação | regra 13 |

### 7.3 Modelo de dados

#### `priv.proposta_envios`

| Coluna | Tipo | Nulo | Regra |
| --- | --- | --- | --- |
| id | uuid | não | v7, PK |
| empresa_id | uuid | não | FK `core.empresas` |
| proposta_id | uuid | não | FK `(proposta_id, empresa_id)` → `priv.propostas`; a proposta tem de estar `final` (conferido na função) |
| proposta_versao | int | não | cópia da versão no momento do registro |
| formato | text | não | `docx`, `pdf`, `outro` |
| proposta_sha256 | text | sim | SHA-256 do nosso arquivo no formato informado (nulo se `outro`) |
| enviado_em | timestamptz | não | informado pela pessoa; `<= registrado_em + 5 min` |
| portal | text | sim | ≤ 120 |
| identificador_portal | text | sim | ≤ 120 (número da proposta/recibo no portal) |
| comprovante_documento_id | uuid | não | FK `(…, empresa_id)` → `priv.documentos`, tipo `comprovante_envio_proposta` |
| comprovante_versao_id | uuid | não | FK `priv.documento_versoes`; versão `liberado` no momento do registro |
| observacao | text | sim | ≤ 1000 |
| registrado_em | timestamptz | não | default now() |
| registrado_por | uuid | não | default `core.usuario_atual()` |
| anulado_em, anulado_por, anulado_motivo | timestamptz, uuid, text | sim | os três juntos (check); motivo 10 a 1000 |
| created_at, updated_at | timestamptz | não | |

**Índices:** `(proposta_id, registrado_em desc)`, `(empresa_id)`. **Unicidade:** `(id, empresa_id)` (sem unicidade por proposta: reenvio é permitido).

**Gatilho de imutabilidade:** UPDATE só pode preencher os três campos de anulação uma vez; qualquer outro UPDATE é recusado. Sem DELETE para `vv_api`. Auditoria por `audit.registrar()` (`enable always`).

**Tipo de documento novo** (`pub.tipos_documento`, por migration): `comprovante_envio_proposta` ("Comprovante de envio de proposta"), `exige_validade = false`, numa **pasta nova `licitacao`** ("Documentos da licitação"), compartilhada com o bloco 9.5 (spec da Fase 09, §5). Exige ampliar o check de `pasta` e o rótulo da pasta no front da Fase 03.

**RLS:**

| Operação | Policy |
| --- | --- |
| select | `core.has_permission(empresa_id, 'propostas', 'visualizar')` |
| insert / update | nenhuma; só pelas funções abaixo (security definer) |
| delete | nenhuma |

**Funções:**

- `priv.registrar_envio_proposta(p_empresa, p_proposta, p_enviado_em, p_formato, p_portal, p_identificador, p_documento, p_observacao) returns uuid` — confere `propostas/<ação da pergunta 2>` e `documentos/visualizar`; proposta da empresa e `final`; documento da empresa, do tipo certo, com última versão `liberado`; `enviado_em` não futuro; copia versão e hash; atualiza as participações (RF-08.11); devolve o id.
- `priv.anular_envio_proposta(p_empresa, p_envio, p_motivo)` — mesma permissão; só anula uma vez.

### 7.4 Permissões (sugestão de padrão; a matriz é por vínculo)

| Operação | ADMIN_EMPRESA | OPERADOR | JURÍDICO | CLIENTE | Step-up |
| --- | --- | --- | --- | --- | --- |
| Ver envios (`propostas/visualizar`) | sim | sim | sim | sim (leitura) | não |
| Ver/baixar comprovante (`documentos/visualizar`) | sim | conforme vínculo | conforme vínculo | conforme vínculo | não |
| Enviar o arquivo do comprovante (`documentos/cadastrar`) | sim | conforme vínculo | conforme vínculo | não | não |
| Registrar / anular envio (pergunta 2) | sim | se tiver a ação | se tiver a ação | não | não (pergunta 6) |

### 7.5 API

| Rota | Permissão | Corpo | Resposta |
| --- | --- | --- | --- |
| `GET /empresas/:empresa/propostas/:id/envios` | `propostas/visualizar` | — | `{ envios: [{ id, propostaVersao, formato, propostaSha256, enviadoEm, portal, identificadorPortal, comprovante: { documentoId, versaoId, nome, status } \| null, observacao, registradoEm, registradoPor: { nome }, anulado: { em, por, motivo } \| null, avisos: [codigo] }] }` — `comprovante` é `null` sem `documentos/visualizar` (o envio aparece, o arquivo não) |
| `POST /empresas/:empresa/propostas/:id/envios` | pergunta 2 (+ `documentos/visualizar` no banco) | `{ enviadoEm (ISO com fuso), formato, portal?, identificadorPortal?, documentoId, observacao? }` | `201 { id, avisos }`; `400` proposta não final, comprovante não liberado/tipo errado, data futura; `404` proposta/documento de outra empresa (mesma resposta de inexistente) |
| `POST /empresas/:empresa/proposta-envios/:id/anular` | pergunta 2 | `{ motivo }` | `204`; `400` já anulado ou motivo curto; `404` |

O upload do comprovante usa as rotas existentes da Fase 03 (criar documento em quarentena → envio direto ao armazenamento → verificação do worker); o download usa a rota de download de documentos (URL de 60 s, auditada). A lista de propostas (`GET …/acompanhamentos/:id/propostas`) passa a trazer `ultimoEnvio` (não anulado) de cada versão.

### 7.6 Telas

| Tela | Rota | Estados | 360 px |
| --- | --- | --- | --- |
| Envio ao portal (seção na versão `final`) | `/agenda/acompanhamentos/:id/proposta` | sem envio ("O sistema não envia propostas. Envie no portal e registre aqui o comprovante."); enviando arquivo (quarentena, verificação com espera crescente como em `EnviarAnexo.tsx`); comprovante recusado (motivo); registrado (data/hora, portal, identificador, quem); anulado (riscado, motivo); avisos em amarelo; erro; sem permissão (botão oculto, histórico visível) | formulário em coluna única; data e hora em campos nativos (horário de Brasília); botão "Registrar envio" fixo no rodapé; histórico em cartões |
| Selo no acompanhamento | `/agenda/acompanhamentos/:id` | "Proposta enviada em dd/mm hh:mm" ou nada | selo curto no cabeçalho |

### 7.7 Critérios de aceite

| # | Critério | Como será comprovado |
| --- | --- | --- |
| CA-6 | Só proposta `final` aceita registro; rascunho/conferência/aprovada recusados | pgTAP + e2e |
| CA-7 | Sem comprovante liberado da própria empresa e do tipo certo, o registro é recusado | pgTAP + e2e |
| CA-8 | Registro guarda versão, hash do nosso arquivo e versão do comprovante; UPDATE fora da anulação é recusado | pgTAP |
| CA-9 | Registrar move itens para `proposta_cadastrada` sem regredir status avançado | pgTAP |
| CA-10 | Envio após o encerramento gera aviso e não bloqueia | e2e |
| CA-11 | A x B: B não lista, não registra, não anula e não baixa comprovante de A (404) | pgTAP de isolamento + e2e |
| CA-12 | Não existe rota/job que envie a portal (varredura de rotas e de tipos de job) | e2e `rotas` + revisão |

### 7.8 Ameaças (proposta para `docs/threat-model.md`)

| Ameaça | Controle | Teste |
| --- | --- | --- |
| **T6** · registro falso ou errado (data, versão) | imutável, auditado, quem/quando; anulação com motivo; versão e hash copiados | CA-8 |
| **T1** · comprovante (pode mostrar preço) visto por outra empresa | RLS `propostas` + `documentos`, 404 sem revelar | CA-11 |
| **T3** · comprovante malicioso (PDF/imagem) | fluxo da Fase 03 (quarentena, antivírus, tipo real); nunca renderizado no servidor | testes da Fase 03 |
| **T14 (nova)** · pressão para "automatizar o envio" (credencial de portal no sistema) | regra 17; nenhuma coluna de credencial; CA-12 | revisão |

### 7.9 Plano de entregas

1. Migration (`priv.proposta_envios`, funções, gatilho, tipo de documento e pasta `licitacao`) + pgTAP + isolamento A x B.
2. API (3 rotas + `ultimoEnvio`) + e2e A x B.
3. Tela (seção "Envio ao portal" com upload reaproveitado de `EnviarAnexo`) e selo.

### 7.10 Decisões adotadas (2026-11-08)

1. ⚖️ **O que vale como comprovante:** **(a) qualquer arquivo liberado + campo livre `tipo_comprovante` e `identificador_portal` opcional** até definição específica do jurídico por portal.
2. **Quem é "pessoa autorizada" para registrar/anular:** **(a) `propostas/aprovar`** (mesmo nível de quem aprova a proposta, sem alterar o check de `core.permissoes.acao`).
3. **Representante:** **campo opcional `representante_id` informativo** neste bloco, sem bloqueio.
4. **Status:** **`proposta_cadastrada`** (`proposta_enviada` permanece como legado e não é mais gravado).
5. **Envio depois do encerramento:** **aviso não bloqueante** (o registro documenta o fato ocorrido).
6. **Step-up ao registrar/anular:** **não** (aprovar a proposta final já exige step-up).
7. **Comprovante de protocolo das peças (Fase 10):** **item separado futuro** depois deste bloco, sem alterar a Fase 10 agora.
8. **Comparar o arquivo enviado com o nosso hash:** **não** (assinatura digital no portal muda o hash; guardam-se o hash da nossa versão final e o hash do comprovante).
