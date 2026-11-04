# Spec · Fase 04 · Motor de pesquisa automática de licitações

- **Status:** Rascunho
- **Onda:** 3 (o modelo `pub.editais` e a importação manual nascem antes, para alimentar a Fase 05)
- **Autor:** Claude Code (2026-11-04) · **Aprovação:** pendente (Adriano Vale)
- **Validação jurídica:** pendente (marcação ME/EPP e cota reservada por item; termos de uso das fontes)
- **Fontes:** Prompt Mestre Fase 04 (4.1 a 4.10); Plano, Fase 04; ADR-008 (busca: `tsvector` + `pgvector`), ADR-014 (fila `ops.jobs` e agendador), ADR-017 (arquivos e cifra), ADR-003/013 (dado público x privado); Fase 03 (quarentena e verificação de arquivos); `docs/threat-model.md` (T3, T7)

> Estado de partida: já existem `ops.jobs` (fila com `SKIP LOCKED`, idempotência e backoff), o pipeline de arquivos da Fase 03 (S3, quarentena, ClamAV, tipo real, SHA-256), `pgvector` na imagem do Postgres, `priv.palavras_chave` e `priv.palavras_chave_filtros` (Fase 02), push e e-mail pelo worker. **Não existem** `pub.orgaos`, `pub.editais`, `ops.fontes`, `ops.execucoes` nem qualquer conector.

## 1. Escopo

**Entra:**

- Cadastro de fontes e histórico de execuções (`ops.fontes`, `ops.execucoes`); agendador no worker às 07h00, 12h00 e 17h00 (`America/Sao_Paulo`), pesquisa manual sob demanda e alerta quando uma execução programada não acontece.
- Conector **PNCP** (API pública de consulta; PR e SC) e, como segunda fonte, **Compras.gov.br** (dados abertos). Cada fonte é um conector isolado.
- Modelo público de licitações: `pub.orgaos`, `pub.editais`, `pub.edital_versoes`, `pub.edital_itens`, `pub.edital_arquivos`, `pub.trechos`, `pub.edital_eventos`.
- Download dos arquivos do edital (edital, TR, ETP, anexos, planilhas, retificações, avisos) pelo pipeline da Fase 03; extração de texto com página (PDF, OCR de escaneados, XLSX); guarda de original, URL, data/hora e hash.
- Itens individualizados (um edital de 8 itens = 8 registros), marcação de benefício ME/EPP por item, deduplicação, retificação como nova versão com evento de reavaliação.
- Relevância por empresa (palavras-chave + similaridade semântica com o catálogo), com "Baixa relevância" nunca descartada.
- Painel de cobertura e falhas, importação manual (URL ou upload) e métrica mensal de cobertura contra a amostra de referência.

**Não entra (e onde fica):**

| Fica de fora | Onde fica |
| --- | --- |
| Portais de disputa (BLL, BNC, Licitanet, ComprasBR, Portal de Compras Públicas, Licitações-e), diários oficiais e agregadores privados | Fase 13 (um conector por fonte, depois de checar termos de uso e contrato) |
| Agenda, prazos jurídicos e alertas de disputa; consumo dos eventos de retificação | Fase 05 (aqui só nasce `pub.edital_eventos`) |
| Análise técnica por IA, ATENDE/NÃO ATENDE, citação verificada | Fase 06 (aqui só texto, trechos e embeddings; **nenhum LLM**) |
| `priv.participacoes` (empresa x item) e decisão de participar | Fase 05 |
| Credenciais de portais no cofre (certificado, senha de fonte) | Fase 13 + ADR-007 (PNCP e Compras.gov.br são públicos e não usam credencial) |
| Qualquer ação no portal (protocolar, propor, dar lance) | Nunca (regra 17) |

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-04.1 | Varredura principal às 07h00 e incrementais às 12h00 e 17h00 (Brasília), executadas pelo worker independentemente de haver usuário conectado | Prompt 4.1 |
| RF-04.2 | Pesquisa manual sob demanda (SUPERADMIN e quem tiver `editais/cadastrar`), registrada como execução do tipo `manual` | Prompt 4.1 |
| RF-04.3 | Execução programada que não ocorre (ou que não termina) gera alerta imediato ao SUPERADMIN por notificação, push e e-mail; heartbeat externo (Healthchecks.io) | Prompt 4.1; Plano 04; T7 |
| RF-04.4 | Cobertura inicial PR e SC (todos os tipos de contratante público), com parâmetros prontos para outras UFs sem migration | Prompt 4.2 |
| RF-04.5 | Conector PNCP primeiro e obrigatório; conector Compras.gov.br como segunda fonte; método preferido API oficial > dados abertos > feed > página (página só se os termos permitirem) | Prompt 4.3; Plano 04 |
| RF-04.6 | Cadastro de fonte com nome, endereço, tipo de integração, referência de credencial, frequência, última pesquisa, último resultado, status, erros e histórico de disponibilidade | Prompt 4.3 |
| RF-04.7 | Conectores isolados: a falha de um não interrompe os demais; retry com espera progressiva; após N falhas seguidas a fonte vira `indisponivel` e alerta | Prompt 4.3; T7 |
| RF-04.8 | Busca por palavras-chave cadastradas e por similaridade semântica, inclusive quando o produto só aparece no TR ou nos anexos | Prompt 4.4 |
| RF-04.9 | Todo arquivo baixado passa por quarentena, antivírus, tipo real, tamanho e SHA-256; guardar original, URL, data/hora de coleta e hash | Prompt 4.5; ADR-017 |
| RF-04.10 | Extração de texto de edital, TR, ETP, anexos, planilhas, retificações e avisos; todo trecho aponta o arquivo e a página de origem; OCR para PDF escaneado | Prompt 4.5; Plano 04 |
| RF-04.11 | Texto de documento externo é dado, nunca instrução; nunca renderizado como HTML | Prompt 4.5; T3 |
| RF-04.12 | Cada item (e cada lote, quando o julgamento é por lote) gera registro próprio; marcar exclusivo ME/EPP, cota reservada e ampla concorrência por item | Prompt 4.6 |
| RF-04.13 | Deduplicação pela chave identificador oficial + órgão + edital + lote + item; republicação e retificação atualizam o processo original, criam versão e disparam evento de reavaliação | Prompt 4.7 |
| RF-04.14 | Relevância por empresa; baixa pontuação vai para "Baixa relevância", nunca é apagada; filtros (UF, município, faixa de valor, restrição) viram motivo registrado, não descarte | Prompt 4.8; ADR-008 |
| RF-04.15 | Painel de cobertura e falhas com os indicadores de 4.9; fonte indisponível gera alerta e **nunca** a mensagem "nenhuma oportunidade" | Prompt 4.9 |
| RF-04.16 | Importação manual de edital não encontrado, por URL (fonte permitida) ou upload | Prompt 4.9; Plano 04 |
| RF-04.17 | Amostra de referência (mín. 50 editais reais de PR e SC) e job mensal que mede a cobertura (meta ≥ 95%), lista os não encontrados e a causa | Prompt 4.10; Plano 04 |
| RF-04.18 | Dado público (`pub.*`) legível por qualquer usuário autenticado e escrito só pelo worker; resultado por empresa (`priv.oportunidades`) isolado por RLS | Plano (modelo núcleo); regra 13 |

## 3. Modelo de dados

Convenções: UUID v7; `snake_case`; dinheiro `numeric(18,4)`; datas com fuso. Tabelas `pub.*` e `ops.*` **não têm `empresa_id`**; só `priv.*` tem. Escrita em `pub.*` e `ops.*` é do `vv_worker` (que ignora RLS, ADR-013); a API (`vv_api`) só **lê** `pub.*` e só escreve em `priv.*` por colunas com grant explícito. Os nomes de campos do PNCP e do Compras.gov.br abaixo são o modelo interno; o mapeamento exato é confirmado contra a documentação oficial e fixtures gravadas no primeiro bloco do conector.

### `ops.fontes` (SUPERADMIN)

| Coluna | Tipo | Nulo | Regra |
| --- | --- | --- | --- |
| id | uuid | não | v7, PK |
| slug | text | não | único (`pncp`, `comprasgov`) |
| nome, url_base | text | não | `url_base` https |
| tipo_integracao | text | não | `api_oficial`, `dados_abertos`, `feed`, `pagina` |
| credencial_ref | text | sim | referência ao cofre (ADR-007); nulo nas duas fontes desta fase |
| hosts_permitidos | text[] | não | hosts aceitos para baixar arquivo desta fonte (anti-SSRF) |
| termos_uso_url | text | sim | onde foram verificados os termos |
| horarios | text[] | não | padrão `{07:00,12:00,17:00}` |
| ativa | boolean | não | |
| status | text | não | `ok`, `degradada`, `indisponivel`, `desativada` |
| falhas_consecutivas | int | não | zera no sucesso |
| ultima_pesquisa_em, ultimo_sucesso_em | timestamptz | sim | |
| ultimo_resultado | text | sim | texto curto, sem dado sensível |
| parametros | jsonb | não | UFs, modalidades, tamanho de página, limite de requisições |

**RLS:** select, insert e update só `core.is_superadmin()`; delete nenhuma. O worker atualiza `status`, contadores e datas por função própria.

### `ops.execucoes`

`id`, `fonte_id`, `tipo` (`principal`, `incremental`, `manual`, `importacao`), `agendada_para`, `iniciada_em`, `concluida_em`, `janela_ini`, `janela_fim`, `status` (`agendada`, `executando`, `ok`, `parcial`, `falhou`, `perdida`), contagens por etapa (`processos_encontrados`, `editais_novos`, `editais_atualizados`, `arquivos_baixados`, `arquivos_processados`, `itens_extraidos`, `itens_pendentes`), `erro_tipo`, `detalhe jsonb` (sem PII), `job_id`. **Única** `(fonte_id, tipo, agendada_para)` (idempotência do agendador). RLS: SUPERADMIN lê; um resumo sem detalhe sai por view para o banner (ver §6).

### `ops.fonte_checagens`

Histórico de disponibilidade: `fonte_id`, `em`, `ok`, `latencia_ms`, `erro_tipo`. Retenção `<A DEFINIR>`.

### `pub.orgaos`

`id`, `cnpj` (14 dígitos), `unidade_codigo`, `razao_social`, `esfera` (`municipal`, `estadual`, `federal`, `distrital`), `tipo` (prefeitura, secretaria, autarquia, câmara, universidade, hospital, consórcio, fundação, empresa pública, economia mista, outro), `uf`, `municipio`, `codigo_ibge`, `uasg` (nulo). **Único** `(cnpj, unidade_codigo)`. RLS: select a qualquer autenticado; sem insert/update/delete para `vv_api`.

### `pub.editais`

| Coluna | Tipo | Nulo | Regra |
| --- | --- | --- | --- |
| id | uuid | não | v7, PK |
| fonte_id | uuid | não | FK `ops.fontes` |
| id_externo | text | não | identificador oficial (número de controle PNCP) |
| orgao_id | uuid | não | FK `pub.orgaos` |
| numero_edital, processo | text | sim | |
| modalidade, modo_disputa, criterio_julgamento | text | sim | valores da fonte, normalizados em listas fechadas |
| srp | boolean | não | registro de preços |
| julgamento_por | text | não | `item` ou `lote` |
| objeto | text | não | exibido como texto, nunca HTML |
| valor_estimado | numeric(18,4) | sim | nulo se sigiloso (`sigiloso` boolean) |
| situacao | text | não | divulgada, suspensa, revogada, anulada, encerrada... (lista da fonte) |
| data_publicacao, data_abertura_propostas, data_encerramento_propostas, data_sessao | timestamptz | sim | `data_sessao` alimenta a Fase 05 e `checklist_documental` |
| portal, link_origem, link_portal | text | sim | https; `link_origem` leva ao registro oficial (link verificável) |
| versao_atual | int | não | começa em 1 |
| hash_conteudo | text | não | SHA-256 do conteúdo normalizado (detecta retificação) |
| origem | text | não | `automatica` ou `manual` |
| primeira_coleta_em, ultima_coleta_em | timestamptz | não | |

**Único** `(fonte_id, id_externo)`. **Índices:** `(orgao_id)`, `(data_sessao)`, `(data_publicacao desc)`, GIN no `tsvector` do objeto.

### `pub.edital_versoes` (só inserção)

`id`, `edital_id`, `versao`, `coletada_em`, `hash_conteudo`, `campos_alterados text[]`, `conteudo jsonb` (cópia normalizada do dado público). Única `(edital_id, versao)`. Permite a comparação entre versões que a Fase 05 (5.5) exige.

### `pub.edital_itens`

`id`, `edital_id`, `tipo` (`item`, `lote`), `numero_item`, `lote_numero`, `pai_id` (item aponta o lote), `descricao`, `quantidade numeric(18,4)`, `unidade_medida`, `valor_unitario_estimado numeric(18,4)`, `valor_total_estimado numeric(18,4)`, `beneficio` (`exclusivo_me_epp`, `cota_reservada`, `ampla_concorrencia`, `nao_informado`), `situacao`, `versao_inicial`, `versao_final` (nula = vigente). **Único** `(edital_id, tipo, numero_item)`. Regra: o registro de lote **não soma** valores dos itens (sem agregação indevida); quando o julgamento é por lote, o lote é o registro disputável e os itens são filhos informativos.

### `pub.edital_arquivos`

`id`, `edital_id`, `tipo` (`edital`, `termo_referencia`, `etp`, `anexo`, `planilha`, `retificacao`, `aviso`, `outro`), `titulo`, `url_origem`, `coletado_em`, `tamanho`, `sha256`, `tipo_real`, `arquivo_chave` (S3 `editais/{edital_id}/{sha256}`), `status_arquivo` (`pendente`, `quarentena`, `liberado`, `bloqueado`, `grande_demais`, `falhou`), `motivo`, `paginas`, `status_extracao` (`pendente`, `ok`, `parcial`, `ocr`, `falhou`, `nao_suportado`). **Único** `(edital_id, url_origem, sha256)`: arquivo trocado na mesma URL vira novo registro e o antigo é preservado.

### `pub.trechos`

`id`, `edital_id`, `arquivo_id`, `item_id` (nulo), `pagina`, `ordem`, `texto` (limite por trecho), `origem_extracao` (`texto`, `ocr`), `confianca_ocr` (nulo), `tsv tsvector` (config `portuguese` + `unaccent`), `embedding vector(<A DEFINIR>)`, `embedding_modelo`. GIN em `tsv`; índice vetorial (HNSW) em `embedding`. Todo trecho aponta arquivo e página (RF-04.10).

### `pub.edital_eventos` (só inserção)

`id`, `edital_id`, `tipo` (`novo`, `retificado`, `data_alterada`, `arquivo_novo`, `situacao_alterada`), `versao`, `em`. É o ponto de ligação com as Fases 05, 06 e 10 (reavaliação); elas consomem, esta fase só produz.

### `priv.oportunidades` (por empresa)

| Coluna | Tipo | Nulo | Regra |
| --- | --- | --- | --- |
| id | uuid | não | v7, PK |
| empresa_id | uuid | não | FK `core.empresas` (cascade, entra na lista do teste 080) |
| item_id | uuid | não | FK `pub.edital_itens`; **único** `(empresa_id, item_id)` |
| nota | smallint | não | 0 a 100 |
| faixa | text | não | `alta`, `media`, `baixa` |
| motivos | jsonb | não | lista `{tipo, termo, onde, arquivo_id, pagina}`: por que pontuou |
| fora_dos_filtros | jsonb | não | filtros não atendidos (UF, município, valor, restrição) |
| semelhanca | numeric(5,4) | sim | similaridade semântica |
| versao_regra | text | não | versão do algoritmo |
| edital_versao | int | não | versão do edital avaliada |
| triagem | text | não | `nova`, `vista`, `interesse`, `descartada_pelo_usuario` |
| triagem_motivo, triagem_por, triagem_em | | sim | descartar exige motivo; **nunca delete** |
| avaliada_em | timestamptz | não | |

**RLS:** select `core.has_permission(empresa_id, 'editais', 'visualizar')`; update só de `triagem*` com `'editais','editar'`; **sem insert/delete** para `vv_api` (quem grava nota é o worker). **Índices:** `(empresa_id, faixa, avaliada_em desc)`.

### `priv.importacoes`

`id`, `empresa_id`, `tipo` (`url`, `upload`), `url`, `arquivo_chave` (quarentena), `status` (`pendente`, `processando`, `ok`, `falhou`), `edital_id` (nulo), `erro`, `solicitado_por`, `created_at`. RLS por `editais/cadastrar` (insert por função que enfileira o job) e `editais/visualizar` (select). Guarda **quem** pediu; o edital resultante é público e não registra a empresa.

### `ops.amostra_cobertura` e `ops.cobertura_resultados`

Amostra: `id`, `referencia` (número de controle PNCP ou link), `uf`, `orgao_nome`, `objeto_resumo`, `data_publicacao`, `levantado_por`, `mes_referencia`. Resultado mensal: `amostra_id`, `apurado_em`, `encontrado boolean`, `edital_id`, `causa` (`fonte_nao_coberta`, `filtro_uf_modalidade`, `falha_conector`, `janela_de_data`, `nao_publicado_no_pncp`, `outra`), `causa_detalhe`. RLS: SUPERADMIN.

### Jobs novos em `ops.jobs`

`coletar_fonte`, `detalhar_edital`, `baixar_arquivo`, `verificar_arquivo` (existente, reaproveitado), `extrair_texto`, `indexar_trechos`, `avaliar_relevancia`, `importar_edital`, `vigiar_execucoes`, `apurar_cobertura`. Payload só com IDs.

## 4. Regras de negócio

1. **Agendador.** O worker enfileira `coletar_fonte` por fonte ativa às 07h00 (principal) e 12h00 e 17h00 (incrementais), no fuso `America/Sao_Paulo`, com chave de idempotência `coleta:{fonte}:{AAAA-MM-DDTHH}`; dois workers não duplicam. Ao subir depois de uma queda, o worker confere a última janela e, se foi perdida, cria a execução como `perdida` (alerta) e **recupera** a coleta.
2. **Janela incremental com sobreposição.** A coleta pede dados desde a última execução bem-sucedida **menos uma folga** (`<A DEFINIR>`, ex.: 2 h) para não perder publicação em atraso; a idempotência do upsert absorve a repetição.
3. **Vigilância.** `vigiar_execucoes` (a cada 5 min) cria `perdida` e alerta se a execução prevista não iniciou em `<A DEFINIR: 15 min>` ou se ficou `executando` além do limite; cada execução bem-sucedida pinga o Healthchecks.io; ausência em 30 min alerta o SUPERADMIN por e-mail e push (ADR-014).
4. **Falha de fonte.** Retry com espera progressiva dentro do job; após `<A DEFINIR: 3>` execuções seguidas com falha a fonte vira `indisponivel` e alerta. Resultado parcial (algumas páginas) é `parcial`, nunca `ok`. **A interface jamais mostra "nenhuma oportunidade" sem mostrar a última busca bem-sucedida e o estado das fontes.**
5. **Conector (PNCP).** Filtros por UF (PR, SC), data de publicação e de atualização, modalidade; paginação completa (contador de páginas conferido contra o total informado; divergência = `parcial`); `User-Agent` identificando o robô e um contato; limite de requisições por segundo configurável; respeito a robots.txt e aos termos de uso quando a fonte for página. Resposta malformada de um registro isola o registro (vai para `itens_pendentes` com erro), não derruba a coleta.
6. **Deduplicação.** Chave do edital: `(fonte, id_externo)`. Item: `(edital, tipo, número)`. Republicação ou retificação do mesmo identificador **atualiza o original**: calcula o `hash_conteudo`; se mudou, grava `edital_versoes`, incrementa `versao_atual`, ajusta `versao_final` dos itens removidos, registra `campos_alterados` e emite `pub.edital_eventos`. Mesmo conteúdo reenviado não gera versão.
7. **Itens.** Edital com N itens gera N registros `item`; lote gera o registro `lote` quando `julgamento_por = 'lote'` (sem somar valores). Benefício por item vem **literalmente do campo da fonte**; ausente = `nao_informado`, nunca deduzido por texto nesta fase. ⚖️ **VALIDAR JURÍDICO:** correspondência entre os códigos da fonte e `exclusivo_me_epp` / `cota_reservada` / `ampla_concorrencia` (LC 123, art. 48).
8. **Arquivos.** URL só em `https` e em host da lista `hosts_permitidos` da fonte; sem redirecionamento para outro host; tamanho e tempo limitados; nenhuma execução nem renderização do conteúdo. Fluxo: baixar para quarentena → antivírus → tipo real (lista de tipos: PDF, imagens, DOCX, XLSX, ODT, ZIP conforme pergunta 7) → SHA-256 → chave definitiva `editais/{edital_id}/{sha256}`. Arquivo bloqueado ou grande demais fica registrado com motivo e link de origem; **a oportunidade não some**. Mesmo hash na mesma URL não é baixado de novo.
9. **Extração.** PDF com texto: texto por página; PDF sem texto: OCR em português (`origem_extracao = 'ocr'`, com confiança); planilha: leitura de valores, **sem executar macros nem fórmulas externas** (`.xlsm` recusado); falha em um arquivo não impede os demais (`status_extracao`). Tempo e memória limitados por arquivo, para PDF malicioso ou gigante não parar o worker. Texto extraído é guardado e exibido **como texto**; nada nele é obedecido (regra 16).
10. **Relevância (código puro, sem IA).** Nota 0–100 calculada em `rules/relevancia.py`: (a) casamento de termos cadastrados (`palavra`, `sinonimo`, `categoria`, `marca`, `modelo`, `relacionado`) no item, no objeto e nos trechos, com pesos distintos por local e tipo; (b) similaridade semântica entre os trechos/o item e o catálogo da empresa (nome, categoria e ficha dos produtos); (c) termos de `exclusao` reduzem a nota e ficam registrados; (d) filtros (`uf`, `municipio`, `faixa_valor`, `restricao`) não atendidos **não descartam**: viram `fora_dos_filtros` e rebaixam a faixa. Pesos e limiares: `<A DEFINIR>`, calibrados com a amostra; a regra tem `versao_regra` e cada nota guarda os `motivos` com arquivo e página. Nota baixa = faixa `baixa` ("Baixa relevância"), visível, filtrável, **nunca apagada**. Valores monetários em `Decimal`, nunca `float` (regra 14).
11. **Reavaliação.** Edital novo ou retificado enfileira `avaliar_relevancia` para cada empresa com palavras-chave ativas; item removido na retificação continua em `priv.oportunidades` marcado como retirado, e a triagem do usuário é preservada.
12. **Importação manual.** Por URL: só host em `hosts_permitidos` de alguma fonte ativa; por upload: arquivo passa pela quarentena da Fase 03. O worker resolve a URL, localiza o identificador oficial e grava em `pub` (deduplicando com o que já existe). Edital sem identificador oficial recebe `id_externo` próprio da importação (`manual:` + hash) e `origem = 'manual'`. Edital é ato público; a empresa que importou não aparece em `pub`.
13. **Cobertura mensal.** `apurar_cobertura` verifica cada item da amostra do mês contra `pub.editais`; calcula `encontrados / total`; lista os não encontrados com a causa (classificação por humano quando não for automática); meta ≥ 95%. Sem amostra cadastrada o indicador mostra **"não medido"**, nunca 100%.
14. **Aviso de cobertura incompleta.** Quando a última coleta de uma fonte foi `parcial`, `falhou` ou tem mais de `<A DEFINIR: 26 h>`, o aviso aparece em todas as telas de oportunidades.

## 5. Permissões

Módulo `editais` (já existe na matriz). Operações de plataforma (fontes, execuções, amostra) são só do SUPERADMIN.

| Operação / tela | SUPERADMIN | ADMIN_EMPRESA | OPERADOR | JURÍDICO | CLIENTE | Step-up |
| --- | --- | --- | --- | --- | --- | --- |
| Ver oportunidades, editais, itens e arquivos | sim | `visualizar` | `visualizar` | `visualizar` | só se a empresa conceder `visualizar` | — |
| Triagem (marcar interesse, descartar com motivo) | sim | `editar` | `editar` | — | não | — |
| Pesquisa manual sob demanda; importar edital | sim | `cadastrar` | `cadastrar` | — | não | — |
| Baixar arquivo de edital (URL assinada 60 s, auditada) | sim | `visualizar` | `visualizar` | `visualizar` | só com `visualizar` | — |
| Ver banner de estado das fontes | sim | sim | sim | sim | sim | — |
| Painel de cobertura e falhas completo | sim | não | não | não | não | — |
| Cadastrar/editar fonte, horários e parâmetros | sim | não | não | não | não | sim |
| Cadastrar amostra de cobertura; classificar causa | sim | não | não | não | não | — |
| Reexecutar coleta de uma fonte (ignorar janela) | sim | não | não | não | não | sim |

Perfis e ações seguem `core.has_permission`; a coluna acima mostra o padrão. A pesquisa manual e a importação de empresa comum ficam sujeitas a limite por hora (T7: o robô não pode ser usado para martelar a fonte). Dado de `pub` não é por empresa, mas **só usuário autenticado e com `editais/visualizar` em alguma empresa vinculada** lê (negar por padrão).

## 6. Telas

| Tela | Rota | Estados | Comportamento em 360 px |
| --- | --- | --- | --- |
| Oportunidades (abas Alta, Média, **Baixa relevância**, Todas) | `/oportunidades` | carregando; vazio **com** última busca e estado das fontes; erro; sem permissão; sem palavras-chave ("cadastre palavras-chave") | cards com órgão, UF, objeto, nota, benefício ME/EPP, data da sessão; filtros em folha inferior |
| Edital (itens, arquivos, versões, trechos) | `/editais/:id` | carregando; arquivo em verificação/bloqueado/grande demais; item retirado; erro | abas rolando na horizontal; itens em cartões; link para a fonte oficial sempre visível |
| Comparação de versões | `/editais/:id/versoes` | sem alteração; com alteração (campos destacados) | lista de campos alterados |
| Importar edital (URL ou upload) | `/editais/importar` | enviando; verificando; duplicado ("já existe", com link); falhou com motivo | formulário em coluna única |
| Pesquisa manual | `/oportunidades/pesquisar` | em andamento (progresso por etapa); concluída; limitada por taxa | filtros mínimos (UF, período, palavra) |
| Painel de cobertura e falhas | `/plataforma/cobertura` | todos os indicadores de 4.9; fonte indisponível em destaque; "não medido" | indicadores em cartões, tabela de execuções com rolagem |
| Fontes | `/plataforma/fontes` | lista, edição com step-up, histórico de disponibilidade | cartão por fonte |
| Amostra de cobertura | `/plataforma/cobertura/amostra` | vazia ("não medido"); lista; relatório mensal dos não encontrados | tabela rolável |

Banner fixo nas telas de oportunidades: "Última busca bem-sucedida: …" e, se houver problema, "Fonte X indisponível: oportunidades podem estar faltando". Recurso incompleto aparece como **EM DESENVOLVIMENTO**.

## 7. Jobs e integrações

| Job | Gatilho | Idempotência | Em caso de falha |
| --- | --- | --- | --- |
| `coletar_fonte` | agendador 07h/12h/17h; pesquisa manual; recuperação ao subir | `coleta:{fonte}:{janela}`; upsert pela chave `(fonte, id_externo)` | retry com backoff; página falha = `parcial`; N falhas = fonte `indisponivel` + alerta |
| `detalhar_edital` | edital novo ou com hash diferente | por `(edital, hash)` | volta à fila; registro isolado vai a `itens_pendentes` |
| `baixar_arquivo` | arquivo `pendente` | por `(edital, url, sha256)` | `falhou` com motivo; reintento limitado |
| `verificar_arquivo` | arquivo em quarentena (reaproveita Fase 03) | por versão/arquivo | bloqueado com motivo, nunca liberado |
| `extrair_texto` | arquivo `liberado` | por `(arquivo, sha256)`: regrava trechos de forma atômica | `status_extracao = falhou/parcial`; demais arquivos seguem |
| `indexar_trechos` | trechos sem embedding | por trecho e modelo | volta à fila; trecho sem embedding ainda aparece no full-text |
| `avaliar_relevancia` | edital novo/retificado; palavra-chave alterada | por `(empresa, item, versao_regra, edital_versao)` | volta à fila; nota antiga permanece |
| `importar_edital` | importação manual | por `(url normalizada)` ou hash do arquivo | `priv.importacoes.status = falhou` com motivo |
| `vigiar_execucoes` | a cada 5 min | cria `perdida` uma vez por janela | alerta SUPERADMIN (notificação, push, e-mail) |
| `apurar_cobertura` | dia 1º do mês e sob demanda | por `(amostra, mês)` | relatório marca "não apurado" |

Integrações externas: PNCP (API pública), Compras.gov.br (dados abertos), Healthchecks.io (heartbeat). Nenhuma exige credencial; `User-Agent` identifica o robô. Testes usam **fixtures gravadas**, nunca rede real (regra do repositório); a coleta real é verificada à mão e registrada.

## 8. Ameaças

| Ameaça (T1–T8) | Como esta fase é afetada | Controle | Teste |
| --- | --- | --- | --- |
| T1 | `priv.oportunidades` e `priv.importacoes` carregam dado de uma empresa; `pub` é compartilhado | RLS por empresa em `priv.*`; `vv_api` sem escrita em `pub`; nota só pelo worker | pgTAP A x B nas duas tabelas `priv`; e2e A x B nos endpoints de oportunidade e importação |
| T2 | Worker usa `BYPASSRLS` e avalia para várias empresas | job recebe `empresa_id` e valida vínculo e palavras-chave da empresa no banco | pytest: job com empresa inexistente/desativada é rejeitado |
| T3 | Edital e anexo são conteúdo hostil (PDF malicioso, texto com "instruções") | quarentena, ClamAV, tipo real, limites de tamanho/tempo/memória; texto só como dado; nunca HTML; **nenhum LLM nesta fase** (embedding não obedece texto) | pytest: EICAR bloqueado, `.exe` renomeado, PDF corrompido isolado, XLSM recusado; Semgrep `dangerouslySetInnerHTML` |
| T7 | Falha silenciosa do agendador e fonte fora do ar vista como "sem oportunidades" | vigia, `perdida`, heartbeat, `parcial`/`indisponivel`, banner obrigatório | pytest com relógio injetável: janela sem execução → alerta; fonte com erro → `indisponivel`; teste de interface: vazio sempre mostra estado das fontes |
| T9 (nova) | **SSRF** no download de arquivo e na importação por URL (URL vem da fonte ou do usuário) | só `https`, lista `hosts_permitidos`, resolução de DNS com bloqueio de IP privado/loopback/metadados, sem redirecionar para outro host, tamanho e tempo limitados | pytest: URL interna, `file://`, redirecionamento externo, DNS para 127.0.0.1 recusados |
| T10 (nova) | **Envenenamento do dado público**: fonte (ou arquivo manual) falsifica edital, link ou prazo e a empresa age sobre ele | `link_origem` sempre para o registro oficial, `origem` visível, versões preservadas, nenhuma ação automática no portal; importação manual só de host permitido ou upload marcado `manual` | teste de interface: origem e link exibidos; pytest: URL fora da lista rejeitada |
| T11 (nova) | **Martelar a fonte** (pesquisa manual em laço) pode bloquear o robô ou violar termos | limite por hora por usuário, limite de requisições por fonte, backoff | pytest do limitador |
| T12 (nova) | **Custo/volume**: milhares de arquivos e embeddings enchem disco e CPU | teto de tamanho por arquivo, ordem de prioridade (itens e edital antes de anexos), métricas de fila; gatilho de reavaliação do ADR-008 | acompanhar tamanho do bucket e idade do job mais antigo |

As entradas T9 a T12 são propostas para `docs/threat-model.md` na entrega desta fase.

## 9. Critérios de aceite

| # | Critério | Origem | Como será comprovado |
| --- | --- | --- | --- |
| CA-1 | Pesquisa executa automaticamente às 07h/12h/17h | Prompt 4.1 | teste do agendador com relógio simulado cria as 3 execuções por dia e não duplica com dois workers; log de execuções reais no Docker |
| CA-2 | Alerta quando a execução programada não ocorre | Prompt 4.1/4.9; Plano | teste: janela sem execução → `perdida` + notificação ao SUPERADMIN; teste do heartbeat ausente |
| CA-3 | Resultados têm link verificável e arquivo original guardado | Prompt 4.5 | teste e2e com fixture: edital com `link_origem`, arquivo com URL, data/hora, hash e `arquivo_chave` |
| CA-4 | Processos repetidos não duplicam | Prompt 4.7 | teste: mesma coleta duas vezes → mesmo número de editais e itens |
| CA-5 | Retificação cria versão e evento | Prompt 4.7 | teste: fixture alterada → `edital_versoes` 2, `campos_alterados`, evento `retificado` |
| CA-6 | Edital de 8 itens vira 8 registros | Prompt 4.6; Plano | teste com fixture de 8 itens (um exclusivo ME/EPP, um com cota reservada, um ampla) |
| CA-7 | Falhas de fonte ficam registradas e não ocultam | Prompt 4.3/4.9 | teste: conector com erro → `indisponivel`, execução `falhou`, banner visível; outro conector segue |
| CA-8 | Arquivo infectado/ilegítimo é bloqueado e a oportunidade permanece | Prompt 4.5; T3 | teste EICAR e `.exe` renomeado no fluxo de edital |
| CA-9 | Texto de edital nunca vira instrução nem HTML | Prompt 4.5 | Semgrep; fixture com "ignore as instruções" produz relevância idêntica à sem a frase |
| CA-10 | Baixa relevância nunca some | Prompt 4.8 | teste: item com nota baixa aparece na aba e permanece após reavaliação |
| CA-11 | Painel mostra os indicadores de 4.9 | Prompt 4.9 | print do painel + teste de contagens contra fixture |
| CA-12 | Importação manual funciona e deduplica | Prompt 4.9 | teste: URL e upload; segunda importação aponta o edital existente |
| CA-13 | Isolamento A x B | regra 13; T1 | pgTAP em `priv.oportunidades` e `priv.importacoes`; e2e dos endpoints |
| CA-14 | SSRF bloqueado | T9 | pytest dos casos de URL |
| CA-15 | **Cobertura medida na amostra, meta ≥ 95%** | Prompt 4.10; Plano | relatório de `apurar_cobertura` sobre a amostra real. **PENDENTE até a Operação VV entregar os 50 editais**; sem eles o indicador fica "não medido" e o aceite desta fase não fecha |

## 10. Plano de blocos (modo rápido: direto no `main`, sem PR)

1. **Banco:** `ops.fontes`, `ops.execucoes`, `ops.fonte_checagens`, `pub.orgaos`, `pub.editais`, `pub.edital_versoes`, `pub.edital_itens`, `pub.edital_arquivos`, `pub.trechos`, `pub.edital_eventos`, `priv.oportunidades`, `priv.importacoes`, RLS, grants do worker e pgTAP (incluindo A x B das tabelas `priv`).
2. **Agendador e vigilância:** APScheduler no worker, `ops.execucoes`, `vigiar_execucoes`, alerta ao SUPERADMIN e heartbeat.
3. **Conector PNCP:** cliente HTTP com limites, paginação, retry, fixtures gravadas; upsert, versões, itens, deduplicação e eventos.
4. **Arquivos e texto:** download seguro (anti-SSRF), reaproveitar a verificação da Fase 03, extração (texto, OCR, planilha), `pub.trechos` e embeddings.
5. **Relevância:** `rules/relevancia.py` com testes primeiro, `avaliar_relevancia`, `priv.oportunidades`.
6. **API e telas:** oportunidades, edital, versões, importação manual, pesquisa manual, banner de estado.
7. **Painel de cobertura:** indicadores de 4.9, fontes, amostra e `apurar_cobertura`.
8. **Compras.gov.br:** segundo conector, mesmo contrato.

Cada bloco fica abaixo de ~500 linhas alteradas quando possível. Testes: `rules/` e SQL complicado primeiro; A x B e e2e entram antes de uso real (AGENTS §0).

## 11. Perguntas abertas

1. **Biblioteca de PDF e licença.** O Plano prevê PyMuPDF, que é **AGPL-3.0**; a regra 7 exige licença compatível. Opções: (a) `pypdfium2` (BSD/Apache) para texto e imagem de página + Tesseract para OCR; (b) PyMuPDF e aceitar a AGPL (ou comprar licença comercial); (c) `pdfminer.six` (MIT, mais lento). *Recomendação:* (a), porque entrega texto por página e rasteriza para o OCR sem obrigação de abrir o código. É dependência nova: preciso do seu OK.
2. **Embeddings.** Opções: (a) modelo local no worker (ex.: `multilingual-e5-small`, 384 dimensões, via ONNX; nada sai do servidor, sem custo por chamada); (b) API paga de provedor (ADR-005). *Recomendação:* (a), porque editais são públicos mas o catálogo e as palavras-chave da empresa não devem sair; custo é só CPU e ~500 MB na imagem. Define a dimensão de `pub.trechos.embedding`.
3. **Modalidades coletadas.** Opções: (a) todas as modalidades da Lei 14.133 (pregão, concorrência, dispensa com disputa, etc.) e deixar a relevância separar; (b) só pregão e concorrência. *Recomendação:* (a), porque "sem descarte silencioso" (4.8) vale também para a coleta.
4. **Pesquisa para empresa sem palavras-chave.** Opções: (a) não avaliar e pedir o cadastro; (b) avaliar só por filtros. *Recomendação:* (a), porque nota sem termo seria arbitrária.
5. **Tamanho máximo de arquivo de edital.** Documentos da empresa têm 25 MB; editais costumam ser maiores. Opções: (a) 100 MB, acima disso `grande_demais` com link; (b) 25 MB. *Recomendação:* (a).
6. **Arquivos ZIP/RAR dos anexos.** Opções: (a) extração segura com limites (profundidade 1, no máximo N arquivos, razão de compressão, tamanho total); (b) registrar como "compactado: pendente" e tratar manualmente. *Recomendação:* (a) para ZIP e (b) para os demais formatos, porque anexo em ZIP é comum e zip bomb tem mitigação conhecida.
7. **Importação por URL.** Opções: (a) só hosts da lista de fontes ativas (pncp.gov.br, compras.gov.br...) e upload para o resto; (b) qualquer URL pública. *Recomendação:* (a), por causa do SSRF (T9).
8. **Edital importado vira público?** Opções: (a) sim, vai para `pub` com `origem = 'manual'` e a empresa não aparece; (b) fica privado da empresa. *Recomendação:* (a), porque edital é ato público e o resto do modelo (itens, eventos, Fase 05) depende de `pub`. ⚖️ **VALIDAR JURÍDICO/LGPD:** upload de arquivo que não seja público.
9. **Healthchecks.io e e-mail real.** O heartbeat e o alerta por e-mail precisam de conta e SMTP reais (em dev vai para o Mailpit). Opções: (a) mesma conta e política do backup (T8.8); (b) outra. *Recomendação:* (a). Depende de você provisionar a conta e o provedor de e-mail.
10. **Contato no `User-Agent` do robô.** Precisa de um e-mail ou página institucional. Qual usar? *Recomendação:* um endereço da VV (não pessoal), porque ele aparece nos logs das fontes.
11. **Limites de requisição e termos de uso.** Vou conferir os termos e a documentação oficial do PNCP e do Compras.gov.br no primeiro bloco do conector e registrar a taxa permitida; até lá, padrão conservador `<A DEFINIR>`. Algum contato na VV que já tenha falado com o PNCP? *Recomendação:* seguir assim.
12. **Pesos e limiares da relevância.** Começam como `<A DEFINIR>`. Opções: (a) calibrar com 20 a 30 editais reais classificados à mão pela operação, junto da amostra de cobertura; (b) fixar valores iniciais e ajustar conforme o uso. *Recomendação:* (a) com (b) como ponto de partida, porque erro aqui é oportunidade perdida (prioridade crítica).
13. **Amostra de 50 editais (CA-15).** Depende da Operação VV (dependência já listada no roadmap). Opções: (a) aprovar a fase com CA-15 `PENDENTE` e medir quando a amostra chegar; (b) segurar o aceite. *Recomendação:* (a), mantendo o indicador "não medido" na tela até lá. Não vou inventar edital para preencher a amostra.
14. **Retenção.** Arquivos, trechos e embeddings de edital crescem sem parar. Opções: (a) guardar tudo por ora; (b) política por idade (ex.: arquivos sem participação após N meses vão para armazenamento frio). *Recomendação:* (a) agora, medindo o tamanho do bucket (T12), e decidir com o jurídico (⚖️ prazo de guarda) antes de uso real.
15. **Quem vê o painel completo.** Opções: (a) só SUPERADMIN, com banner de estado para todos; (b) também ADMIN_EMPRESA. *Recomendação:* (a), porque o painel mostra execuções e erros da plataforma, que não pertencem a nenhuma empresa.
16. **Credenciais de fonte.** PNCP e Compras.gov.br não usam. Para as fontes futuras o cofre (ADR-007) segue sem decisão. *Recomendação:* deixar `credencial_ref` nulo e decidir o ADR-007 antes da Fase 13.
17. **Ordem com a Fase 05.** O Plano põe a 05 antes da 04, mas a 05 está bloqueada pela planilha. Esta fase não depende da 05; só produz `pub.edital_eventos`. Posso seguir com a 04 agora? *Recomendação:* sim.
