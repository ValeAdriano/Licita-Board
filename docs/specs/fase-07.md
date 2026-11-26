# Spec · Fase 07 · Formação de preços e viabilidade comercial

- **Status:** Aprovada em 2026-11-05 (instrução do Adriano: "siga desenvolvendo sem interrupções, uma fase após a outra"). Decisões abaixo são recomendações minhas, registradas para revisão.
- **Onda:** 5
- **Autor:** Claude Code (2026-11-05) · **Aprovação:** Adriano Vale, 2026-11-05
- **Validação:** **🧾 parâmetros tributários pendentes e bloqueantes para o uso real** (precisam do responsável contábil); **⚖️ regras de ME/EPP e de inexequibilidade pendentes do jurídico** (nada é suposto: tudo é parâmetro).
- **Fontes:** Prompt Mestre Fase 07 (7.1 a 7.6) e regras 14 e 15 do AGENTS.md; Fase 02 (`priv.produtos`); Fase 05 (`priv.participacoes`).
- **Bloco 7.5 (§8):** `Aprovada` em 2026-11-08 (Adriano Vale; recomendações de §8.11 adotadas).
- **Bloco em rascunho:** 7.4 · cenários salvos de preço (§9), `Rascunho` desde 2026-11-12; aguarda as respostas de §9.11.

> **Princípios:** dinheiro em `numeric(18,4)` no banco, `decimal.Decimal` no Python e `string` na API e no front, **nunca `float`** (regra 14); todo cálculo em código puro (`apps/worker/src/worker/rules/precos.py`, 100% de cobertura), reproduzível e auditável; a API só grava os insumos e enfileira o worker (como em prazos e análise técnica).

## 1. Escopo

**Entra neste bloco:**

- **Precificação por participação (item) e produto** (`priv.precificacoes`) com **linhas de custo** (`priv.preco_linhas`): custos por unidade ou do lote (aquisição, frete, seguro, instalação, acessórios, garantia adicional, encargos financeiros, outros, contingência) e **percentuais sobre o preço** (tributos, comissão, despesas administrativas), cada linha identificada.
- **`rules/precos.py`:** custo direto unitário; preço mínimo (com a margem mínima), preço de oferta (com a margem desejada), margem bruta e líquida, total da proposta (= quantidade × unitário arredondado), diferença para o valor estimado, sinalização de **abaixo do mínimo** e de **risco de inexequibilidade** (somente se o critério for parametrizado), regra de arredondamento por edital (2 a 6 casas; "arredondar" ou "truncar"), simulação do **empate ficto** de ME/EPP com o percentual como parâmetro.
- **Segregação por empresa e por permissão:** custos e margens só aparecem para quem tem a ação `ver_custos_margens` do módulo `precos`; sem ela o banco devolve vazio.
- **Alçada:** preço proposto abaixo do mínimo só é aprovado com justificativa e por quem tem `precos/aprovar`; tributo só vale como "validado" quando o responsável marca (🧾).
- **Tela:** calculadora do item (linhas, parâmetros, resultado, alertas).

**Fica para os próximos blocos:**

| Item | Por quê |
| --- | --- |
| Histórico comercial de preços vencedores (7.5) | Exige coletar resultados/homologações do PNCP (fonte pública) e busca por produto/marca/órgão. **Rascunho em §8.** |
| Reautenticação ao aprovar preço abaixo do mínimo (7.6) | Depende de definir o "step-up" para essa ação (já existe o mecanismo de MFA recente). |
| Cenários múltiplos salvos (inicial, alvo, mínimo autorizado, pós-negociação) | Entram junto da Fase 09 (disputa). Aqui há o preço mínimo, o de oferta e o proposto. **Rascunho em §9.** |
| Valor por extenso (7.3) | Entra com as propostas (Fase 08). |
| Parâmetros tributários validados | 🧾 contador. |

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-07.1 | Linhas de custo identificadas por tipo; custos por unidade ou do lote | 7.1 |
| RF-07.2 | Percentuais sobre o preço (tributos, comissão, despesas) como parâmetros da empresa, com marca "validado pelo contador" | 7.2 |
| RF-07.3 | Cálculo em `Decimal`; arredondamento por edital; total = quantidade × unitário arredondado | 7.3 |
| RF-07.4 | Preço mínimo, preço de oferta, margens bruta e líquida, diferença para o estimado | 7.2 |
| RF-07.5 | Margem abaixo do mínimo gera alerta e **bloqueia a aprovação** sem justificativa e permissão | 7.6 |
| RF-07.6 | Risco de inexequibilidade só com critério parametrizado; sem critério, "não parametrizado" | 7.4, regra 15 |
| RF-07.7 | Empate ficto de ME/EPP simulado por função pura com o percentual como parâmetro | 7.4 |
| RF-07.8 | Valores de empresas diferentes segregados; custos só com `ver_custos_margens` | 7.5 |

## 3. Fórmulas (todas em `Decimal`)

- `custo_direto_unit = Σ custos por unidade + Σ custos do lote ÷ quantidade`.
- `p = Σ percentuais sobre o preço ÷ 100`. Preço para uma margem `m` (em %): `preco(m) = custo_direto_unit ÷ (1 − p − m/100)`. Se o divisor for ≤ 0, o cálculo é recusado ("os percentuais somam 100% ou mais").
- `preço mínimo = preco(margem mínima)`, arredondado **para cima** (cobre o custo). `preço de oferta = preco(margem desejada)`. `preço final = preço proposto` (se informado) ou o de oferta, arredondado com a regra do edital.
- `total = quantidade × preço final unitário`, em 2 casas. `margem bruta = (preço − custo direto) ÷ preço`; `margem líquida = margem bruta − p`. `diferença = (preço final − estimado) ÷ estimado`.
- **Abaixo do mínimo:** `preço final < preço mínimo`. **Inexequibilidade:** `preço final < estimado × limite%` (limite informado pela empresa; sem limite, "não parametrizado").
- **Empate ficto (função pura):** ME/EPP cuja proposta fica até `percentual%` acima da melhor tem direito a nova oferta. Padrão do Prompt Mestre: 5% (pregão) e 10% (demais); **⚖️ confirmar com o jurídico** e sempre editável.

## 4. Dados e permissões

- `priv.precificacoes` e `priv.preco_linhas` com `empresa_id`, RLS pelo módulo `precos`: leitura exige `ver_custos_margens`; escrita por funções (`editar`), aprovação por `aprovar`; auditoria e teste de isolamento A x B.
- Quantidade, custos, percentuais e preços: `numeric(18,4)`; percentuais `numeric(9,4)`.

## 5. Critérios de aceite (deste bloco)

| ID | Critério | Prova |
| --- | --- | --- |
| CA-1 | Cálculos reproduzíveis, sem ponto flutuante, `rules/precos.py` com 100% de cobertura e casos de borda de arredondamento | pytest |
| CA-2 | Alterar quantidade atualiza os totais | pytest + job com banco |
| CA-3 | Preço abaixo do mínimo gera alerta e bloqueia a aprovação sem justificativa/permissão | pgTAP + e2e |
| CA-4 | Custos de uma empresa nunca aparecem a outra nem a quem não tem `ver_custos_margens` | pgTAP A x B + e2e |
| CA-5 | Parâmetros tributários validados pelo contador | **pendente** 🧾 |

## 6. Perguntas abertas (recomendação minha entre parênteses)

1. 🧾 Quais tributos e alíquotas por regime (Simples, presumido, real) e por operação? (cadastro por empresa, cada linha validada pelo contador antes do uso real.)
2. ⚖️ Percentuais do empate ficto e critério de inexequibilidade por modalidade/objeto. (parâmetros por edital, preenchidos pelo jurídico.)
3. Como a alçada comercial se define (valor/margem por papel)? (hoje: `precos/aprovar`; limites por valor ficam para depois.)

## 7. Estado

### Conferência item a item (2026-11-07)

- ✅ Calculadora por item, dinheiro decimal, custos sigilosos e fluxo de aprovação/alçada: `apps/worker/src/worker/rules/precos.py`, `apps/api/src/precos/precos.controller.ts`, `apps/web/src/features/precos/Calculadora.tsx`.
- ✅ Reautenticação da aprovação abaixo do mínimo consta implementada no fluxo compartilhado de step-up: `apps/api/src/precos/precos.controller.ts`, `apps/web/src/features/precos/Calculadora.tsx`.
- 🟡 Empate ficto: a regra pura existe e tem teste, mas falta endpoint/tela para informar e comparar a melhor oferta: `apps/worker/src/worker/rules/precos.py`.
- ✅ Histórico comercial de preços vencedores/integração de preços PNCP (7.5): migration `20261207100000`, `pub.precos_historicos`, `pub.preco_historico_versoes`, `ops.resultado_coletas`, coletor `worker/pesquisa/resultados.py` + `rules/precos.py` (`estatistica_historico`), API (`GET /precos/historico`, `GET /participacoes/:id/historico-sugerido`, `POST /editais/:id/buscar-resultados`) e telas (`Calculadora.tsx`, `RegistrarResultado.tsx`).
- ❌ Cenários salvos: não localizados em `apps/api/src/precos` nem `apps/web/src/features/precos`.
- 🟡 Valor por extenso: utilitário existe na Fase 08, mas não integrado à tela de preços: `apps/worker/src/worker/rules/extenso.py`.
- ❌ Parâmetros tributários e percentuais de empate/inexequibilidade ainda aguardam validação do contador/jurídico; não há regra ativa que os determine.
- ✅ Q-23 (rodada 2): matriz e2e A x B das 7 rotas `:empresa`, nos dois sentidos, com 404 para empresa e id alheios, recurso da dona intacto e nenhum job criado pela tentativa. Suítes análises/preços: 15 testes verdes; pgTAP executado no banco descartável. Sigilo de custos/margens preservado nas respostas de preços; valores monetários como string.

- 2026-11-05 · spec aprovada; implementação em blocos (regras puras → banco → worker → API → tela).
- **Núcleo pronto (2026-11-05):** `rules/precos.py` (Decimal, 100% de cobertura, casos de borda de arredondamento), migration `20261111100000` (`priv.precificacoes`, `priv.preco_linhas`; leitura só com `precos/ver_custos_margens`; escrita só por função; alçada: abaixo do mínimo exige justificativa e `precos/aprovar`; mudar insumo derruba a aprovação), job `calcular_preco` (`worker/preco.py`), API `apps/api/src/precos`, tela `/agenda/participacoes/:id/preco` (link "Preço" nos itens). Testes: pytest (15 das regras, 5 do job com banco), pgTAP 270 e 2 de isolamento A x B, e2e (sigilo de custos e A x B), formatação do front. Conferido no navegador com o worker real (conta fictícia): preço = custo ÷ (1 − percentuais − margem), arredondado e total conferidos à mão.
- **Histórico comercial de preços vencedores do PNCP (7.5) pronto (2026-11-08, Q-11a/Q-11b):** migration `20261207100000_historico_precos_pncp.sql` (`pub.precos_historicos` com redação LGPD de PF por check no banco, `pub.preco_historico_versoes` imutável, `ops.resultado_coletas` e `ops.solicitar_coleta_resultados_edital` com limite de 1 solicitação por edital por hora → 429), `rules/precos.py` (`estatistica_historico` em `Decimal` com mediana discreta inferior e verificação de unidade única, 100% de cobertura), conector PNCP (`listar_resultados_item` e `normalizar_resultado`) e persistência (`worker/pesquisa/resultados.py`), rotas na API (`GET /empresas/:e/precos/historico`, `GET /empresas/:e/participacoes/:id/historico-sugerido`, `POST /empresas/:e/editais/:id/buscar-resultados`), cartão de referência na calculadora (`Calculadora.tsx`) e sugestão no registro de resultado (`RegistrarResultado.tsx`). Testes: pgTAP `510_historico_precos_pncp` (11/11), pytest (38/38), e2e `precos.e2e-spec.ts` (8/8).
- **Falta na Fase 07:** cenários salvos (entram com a Fase 09), valor por extenso (Fase 08), **simulação do empate ficto na tela** (a função pura `empate_ficto` existe e é testada, mas não há endpoint nem campo para a melhor oferta), parâmetros tributários validados (🧾 contador) e percentuais do empate ficto/inexequibilidade (⚖️ jurídico).

## 8. Bloco 7.5 · Histórico comercial de preços vencedores · **Aprovada**

- **Status deste bloco:** `Aprovada` em 2026-11-08 (Adriano Vale; recomendações de §8.11 adotadas).
- **Fontes:** Prompt Mestre 7.5 (histórico comercial), 9.2 e 9.4 (resultado e licitações ganhas), 12.3 ("preços vencedores anteriores", "margens"), tabela "Separação de dados" do Prompt ("Resultados públicos e preços homologados" = dado público); plano, Fase 07 ("Histórico de preços vencedores importado do PNCP") e Onda 5 (`pub.precos_historicos`); ADR-019 (pesquisa de editais) e o conector `apps/worker/src/worker/connectors/pncp.py`; regras 14, 15 e 16.

> **Princípios:** preço vencedor histórico é **dado de referência**, nunca decisão: não define preço, não aprova nada e não entra na IA. Estatística e comparação são código determinístico em `numeric`/`Decimal` (regra 15), nunca `float` (atenção: `percentile_cont` do Postgres converte para `double precision`; usar `percentile_disc`). Texto vindo do PNCP é dado (regra 16). O dado público fica em `pub` (sem `empresa_id`, só o worker escreve); o que é da empresa (nossa oferta, custo, margem) fica em `priv` e só aparece com `precos/ver_custos_margens` daquela empresa.

### 8.1 Escopo

**Entra:**

- **Coleta dos resultados públicos dos itens** dos editais do PNCP que já estão em `pub.editais` (fonte `pncp`): fornecedor vencedor (só pessoa jurídica identificada), quantidade, valor unitário e total homologados, desconto, data e situação do resultado, marca/modelo **se a fonte trouxer**.
- **Revisita controlada:** um edital encerrado é reconsultado periodicamente até ter resultado em todos os itens ou sair da janela de coleta.
- **Pesquisa do histórico** por texto do item (produto), marca, modelo, órgão, região (UF/município), quantidade, período, empresa vencedora (CNPJ/nome) e faixa de valor unitário, com estatística descritiva (quantidade de resultados, mínimo, mediana, máximo) quando todos os resultados filtrados têm a mesma unidade.
- **Camada privada** na mesma pesquisa: nossa oferta (`priv.resultados_item`) e nosso custo/margem (`priv.precificacoes`) no mesmo item, só com `precos/ver_custos_margens` da empresa.
- **Atalhos:** cartão "Preços vencedores anteriores" na calculadora (Fase 07) com a pesquisa pré-preenchida; sugestão de vencedora e valor no registro de resultado (Fase 09), sempre confirmada pela pessoa.

**Não entra (e onde fica):**

| Item | Onde fica |
| --- | --- |
| Resultados de editais fora de `pub.editais` (outras UFs, anos anteriores à captura) | Pergunta 2 (backfill amplo) |
| Outras fontes (Compras.gov.br dados abertos, portais estaduais) | Fase 13.1 |
| Atas de registro de preços, contratos e arquivos de homologação do PNCP | Fase 13.5 (monitoramento de resultados) e 9.5 (anexo manual) |
| "Margens" e "preços vencedores anteriores" no relatório comercial | Fase 12.3 (usa a tabela deste bloco) |
| Preço de referência automático, sugestão de lance ou de preço | Nunca (regra 15) |
| Normalização automática de unidades diferentes ("UN" × "CX c/ 10") | Só com fator em `pub.unidades`; sem fator, o resultado fica fora da estatística |

### 8.2 Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-07.9 | Coletar do PNCP os resultados dos itens dos editais em `pub.editais`, gravando em `pub.precos_historicos` com fonte, link e data de coleta | 7.5, plano Fase 07 |
| RF-07.10 | Nunca gravar CPF nem nome de fornecedor pessoa física; nunca gravar contato do fornecedor | Prompt "Segurança e governança" (LGPD), AGENTS.md §7 |
| RF-07.11 | Coleta idempotente e auditável: mesma resposta não duplica; mudança (inclusive cancelamento) gera versão; nada é apagado | 7.5, "IDs e relacionamentos persistentes, com histórico" |
| RF-07.12 | Pesquisa por produto (texto), marca, modelo, órgão, UF/município, quantidade, período, empresa vencedora e valor unitário; `%` e `_` não viram curinga | 7.5 |
| RF-07.13 | Estatística descritiva (n, mínimo, mediana, máximo) em `numeric`, só sobre resultados da mesma unidade; fora disso, "unidades diferentes" | 7.3, regra 15 |
| RF-07.14 | Dado comercial privado (nossa oferta, custo, margem) só com `precos/ver_custos_margens` da empresa; nunca de outra empresa | 7.5, regra 13 |
| RF-07.15 | Atalho na calculadora e sugestão no registro de resultado (Fase 09) mostram o histórico; nada é aplicado sem ação humana | 7.5, 9.2, regra 15 |
| RF-07.16 | Falha da coleta aparece no painel das fontes (nunca "zero resultados" silencioso) | 4.x, T7 |

### 8.3 Modelo de dados

#### `pub.precos_historicos` (só o worker escreve)

| Coluna | Tipo | Nulo | Regra |
| --- | --- | --- | --- |
| id | uuid | não | v7, PK |
| fonte_id | uuid | não | FK `ops.fontes` |
| id_externo | text | não | `numeroControlePNCP` + item + sequencial do resultado; 3 a 200 |
| edital_id | uuid | não | FK `pub.editais` |
| edital_item_id | uuid | não | FK `pub.edital_itens`, com `(id, edital_id)` |
| fornecedor_tipo | text | não | `pj`, `pessoa_fisica`, `estrangeiro`, `nao_informado` |
| fornecedor_cnpj | text | sim | `^[0-9A-Z]{14}$`; **só se `pj`** (check) |
| fornecedor_nome | text | sim | ≤ 300; **só se `pj` ou `estrangeiro`** (check) |
| fornecedor_porte | text | sim | ≤ 60, texto da fonte (ME/EPP/demais) |
| beneficio_me_epp | boolean | sim | como veio da fonte; nunca deduzido |
| marca | text | sim | ≤ 120, só se a fonte trouxer |
| modelo | text | sim | ≤ 120, só se a fonte trouxer |
| quantidade | numeric(18,4) | sim | ≥ 0 |
| unidade_medida | text | sim | cópia do item no momento da coleta, ≤ 60 |
| valor_unitario | numeric(18,4) | sim | ≥ 0 |
| valor_total | numeric(18,4) | sim | ≥ 0 |
| percentual_desconto | numeric(9,4) | sim | como veio |
| classificacao | int | sim | ≥ 1 (ordem de classificação, quando houver) |
| data_resultado | timestamptz | sim | horário de Brasília da fonte |
| situacao | text | não | ≤ 80, texto da fonte (ex.: informado, cancelado) |
| cancelado | boolean | não | default false; derivado da situação/data de cancelamento |
| hash_conteudo | text | não | SHA-256 do registro normalizado |
| versao | int | não | ≥ 1; sobe quando o hash muda |
| link_origem | text | não | https, ≤ 500 (página do edital no PNCP) |
| primeira_coleta_em, ultima_coleta_em | timestamptz | não | |
| created_at, updated_at | timestamptz | não | |

**Unicidade:** `(fonte_id, id_externo)`. **Índices:** `(edital_item_id)`, `(edital_id)`, `(fornecedor_cnpj)`, `(data_resultado desc)`, `(valor_unitario)`; o texto do produto usa o índice GIN já existente em `pub.edital_itens.descricao_tsv`; marca/modelo com índice trigram só se o volume pedir (mesmo critério da 12.4).

#### `pub.preco_historico_versoes`

`id`, `preco_historico_id` (FK), `versao`, `coletada_em`, `hash_conteudo`, `campos_alterados text[]`, `conteudo jsonb` (registro normalizado anterior). Unicidade `(preco_historico_id, versao)`. Mesmo padrão de `pub.edital_versoes`.

#### `ops.resultado_coletas` (controle da revisita, só worker)

`edital_id` (PK, FK `pub.editais`), `ultima_verificacao_em`, `proxima_verificacao_em`, `itens_total`, `itens_com_resultado`, `status` (`aguardando`, `parcial`, `completo`, `fora_da_janela`, `falhou`), `erro_tipo` (≤ 100), `falhas_consecutivas`.

#### Mudanças em tabelas existentes (migration nova, nada aplicado é editado)

- `ops.execucoes.tipo`: incluir `resultados`.
- `ops.fontes.parametros` do `pncp`: chave `resultados` com `janela_dias` (365), `revisita_dias` (7), `max_editais_por_execucao` (200), `horarios` (`{03:00}`).

**RLS:**

| Tabela | select | insert/update/delete |
| --- | --- | --- |
| `pub.precos_historicos`, `pub.preco_historico_versoes` | `core.pode_ver_editais()` (mesma regra de `pub.editais`) | nenhuma para `vv_api`; `vv_worker` grava |
| `ops.resultado_coletas` | `core.is_superadmin()` | só `vv_worker` |
| Camada privada (`priv.resultados_item`, `priv.precificacoes`) | sem mudança de policy; a API só consulta essas tabelas se a pessoa tem `precos/ver_custos_margens` (e a RLS de `precificacoes` já exige isso) | — |

Teste de isolamento A x B: as tabelas novas são `pub`/`ops` (sem `empresa_id`); o A x B exigido é o **e2e da camada privada** (B nunca vê oferta, custo ou margem de A no mesmo item, nem com o mesmo edital acompanhado pelas duas).

### 8.4 Regras

1. **Vínculo com o item:** resultado sem item correspondente em `pub.edital_itens` (`edital_id`, `tipo='item'`, `numero_item`) não é gravado; conta como "item não encontrado" no detalhe da execução.
2. **Pessoa física:** `fornecedor_tipo = 'pessoa_fisica'`, sem documento e sem nome (check no banco); aparece como "Pessoa física" na pesquisa.
3. **Cancelado:** fica gravado com `cancelado = true`, sai da estatística por padrão e aparece riscado com a situação da fonte.
4. **Estatística:** só sobre não cancelados e com `valor_unitario` não nulo; mediana com `percentile_disc(0.5)` (valor real da amostra, sem interpolação). Se houver mais de uma `unidade_medida` no filtro, sem estatística ("unidades diferentes: filtre por unidade"). Comparação com o nosso preço (diferença %) só em `numeric` no SQL ou em `rules/` (pergunta 4); nunca no TS.
5. **Arrematação × homologação:** o PNCP publica valor **homologado**; o registro de resultado da Fase 09 continua manual e distinto (não muda `priv.resultados_item` sozinho).
6. **Sem dado sigiloso estimado:** se o item tem orçamento sigiloso, o valor **estimado** continua não guardado (regra já existente); o valor homologado publicado é gravado.

### 8.5 Jobs e integrações (PNCP)

**Endpoints públicos usados (sem autenticação; host `pncp.gov.br`, já em `hosts_permitidos`):**

| Uso | Endpoint | Observação |
| --- | --- | --- |
| Itens do edital, com indicação de resultado | `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens` | já usado em `ConectorPNCP.detalhar`; conferir o campo de "tem resultado" |
| Resultados de um item | `GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens/{numeroItem}/resultados` | lista (pode ter mais de um, ex.: SRP) |
| Descobrir editais alterados | `GET /api/consulta/v1/contratacoes/atualizacao` | já usado na captura incremental; edital alterado ganha revisita antecipada |

> ⚠️ **Os nomes dos campos de resultado (fornecedor, tipo de pessoa, porte, quantidade/valor homologados, desconto, data, situação, marca) não foram conferidos contra a API real neste rascunho.** O primeiro item da implementação grava fixtures reais e ajusta `normalizar_resultado` a elas (mesmo cuidado de `pncp.py`, "campos conferidos contra a API real"). Se marca/modelo não vierem estruturados, as colunas ficam nulas e a busca por marca usa só a camada privada e o texto do item.

| Job | Gatilho | Idempotência | Em caso de falha |
| --- | --- | --- | --- |
| `coletar_resultados_pncp` | agendador, nos `horarios` de `parametros.resultados` (fora dos horários da captura, que divide o mesmo limite de taxa por host) | chave `res:pncp:<data>:<horário>`; por edital, upsert por `(fonte_id, id_externo)` + hash (sem mudança = só `ultima_coleta_em`) | erro de um edital não para os outros (conta em `detalhe`, `falhas_consecutivas` sobe, revisita com espera maior); erro geral = `ops.execucoes` `falhou` e o vigia da fonte avisa |
| `coletar_resultados_edital` | botão "Buscar resultado agora" no edital (quem tem `editais/visualizar`), no máximo 1 por edital por hora | chave `res:edital:<edital_id>:<hora>` | mesmo tratamento; a tela mostra "falhou, tente depois" |

**Seleção dos editais:** `data_encerramento_propostas` (ou publicação, se nula) dentro de `janela_dias`, `ops.resultado_coletas.proxima_verificacao_em <= now()`, status diferente de `completo`/`fora_da_janela`, até `max_editais_por_execucao`, mais antigos primeiro. Editais acompanhados por alguma empresa (`priv.acompanhamentos`) têm prioridade.

**Limites:** cliente HTTP existente (`pesquisa/http.py`): só https, só hosts permitidos, sem redirecionamento, `User-Agent` do robô, taxa por host compartilhada (2 req/s hoje), retry com espera progressiva, JSON lido com `Decimal`. Orçamento de pedidos por execução = `max_editais_por_execucao` × (1 + itens com resultado), com teto `2000` requisições por execução.

**Nunca coletar:** CPF ou nome de pessoa física; e-mail, telefone ou endereço de fornecedor; documentos/arquivos do fornecedor; nada que exija login ou credencial; nada fora da API pública (sem raspagem de portal) neste bloco.

### 8.6 API

| Rota | Permissão | Corpo / parâmetros | Resposta |
| --- | --- | --- | --- |
| `GET /empresas/:empresa/precos/historico` | `editais/visualizar` (pergunta 3) | `texto` (≥ 3 letras, ignora acento), `marca`, `modelo`, `orgao`, `uf`, `municipio`, `fornecedor` (CNPJ ou nome), `de`, `ate` (data do resultado), `qtdMin`, `qtdMax`, `valorMin`, `valorMax` (texto decimal), `unidade`, `incluirCancelados`, `pagina` (50 por página) | `{ itens: [{ id, edital: { id, numero, processo, orgao, uf, municipio, linkOrigem }, item: { numero, descricao, unidade }, fornecedor: { tipo, cnpj, nome, porte }, marca, modelo, quantidade, valorUnitario, valorTotal, desconto, dataResultado, situacao, cancelado, coletadoEm, privado: { nossaOferta, nossaClassificacao, nossoCustoUnitario, nossaMargem } \| null }], estatistica: { n, minimo, mediana, maximo, unidade } \| null, total }` — dinheiro sempre string; `privado` é `null` sem `precos/ver_custos_margens` |
| `GET /empresas/:empresa/participacoes/:id/historico-sugerido` | `editais/visualizar` | — | resultados públicos **do próprio item** (para o registro de resultado da Fase 09) |
| `POST /empresas/:empresa/editais/:id/buscar-resultados` | `editais/visualizar` | — | `202 { jobId }` ou `429` se pedido na última hora |

Erros: `400` filtro inválido (valor não decimal, `de > ate`, texto curto); `404` para participação de outra empresa (sem revelar existência, T1.1).

### 8.7 Telas

| Tela | Rota | Estados | 360 px |
| --- | --- | --- | --- |
| Preços vencedores | `/precos/historico` (item "Preços vencedores" no menu de Preços) | carregando; vazio ("nenhum resultado público com esses filtros"); erro; sem permissão; banner da fonte PNCP degradada; selo "dado público de referência" | filtros num painel recolhível; cada resultado em cartão (item, órgão/UF, vencedora, valor unitário, data, link); estatística no topo em uma linha |
| Cartão na calculadora | `/agenda/participacoes/:id/preco` | sem histórico; com histórico (n, mediana, link "ver todos") | cartão abaixo do resultado do cálculo |
| Sugestão no resultado | formulário de resultado (Fase 09) | sem resultado público; com resultado ("usar estes dados" preenche vencedora e valor, a pessoa confirma) | aviso compacto acima do formulário |

### 8.8 Critérios de aceite

| # | Critério | Como será comprovado |
| --- | --- | --- |
| CA-6 | Resultado coletado de fixture real gravada vira linha em `pub.precos_historicos` com valores exatos (sem float) | pytest do normalizador + job com banco |
| CA-7 | Rodar a coleta duas vezes não duplica; mudança gera versão; cancelamento marca e não apaga | pytest com banco |
| CA-8 | Fornecedor pessoa física nunca tem documento nem nome gravado (check recusa) | pgTAP + pytest |
| CA-9 | Pesquisa recupera por texto, marca, órgão, UF, fornecedor, período, quantidade e valor; `%` não é curinga | e2e |
| CA-10 | Estatística correta (mediana = valor da amostra) e ausente com unidades diferentes | e2e com dados conhecidos |
| CA-11 | `privado` é `null` sem `ver_custos_margens`; B nunca vê oferta/custo/margem de A no mesmo item | e2e A x B |
| CA-12 | Falha da fonte aparece no painel de fontes e na execução, nunca como lista vazia | pytest + e2e |

### 8.9 Ameaças (proposta para `docs/threat-model.md`)

| Ameaça | Controle | Teste |
| --- | --- | --- |
| **T1** · camada privada vaza oferta/custo/margem de outra empresa pela pesquisa pública | `privado` só por consulta em `priv` dentro de `comContexto`, com a ação conferida no guard e na RLS | e2e A x B (CA-11) |
| **T1.2 (nova)** · inferência do nosso preço por quem só tem `editais/visualizar` | camada privada sempre `null` sem `ver_custos_margens`; a pesquisa pública não muda de resultado conforme existam dados privados | e2e |
| **T7** · coleta de resultados consome o limite de taxa e atrasa a captura de editais | horário próprio, orçamento por execução, taxa por host compartilhada | pytest do orçamento |
| **T13 (nova) · LGPD** · gravar dado pessoal de fornecedor pessoa física | check no banco, normalizador descarta, teste | CA-8 |
| **T10.1 (nova, deriva da T10) · dado público errado** (valor digitado errado pelo órgão) tomado como referência | mediana (robusta), link para a fonte, selo "referência", nada automático | revisão |
| **T3** · texto do PNCP com instrução | não passa por IA neste bloco; exibido como texto | — |

### 8.10 Plano de entregas

1. Fixtures reais do PNCP + `normalizar_resultado` (puro) + testes.
2. Migration: `pub.precos_historicos`, `pub.preco_historico_versoes`, `ops.resultado_coletas`, `ops.execucoes.tipo`, parâmetros; pgTAP (checks de PF, grants).
3. Job `coletar_resultados_pncp`/`coletar_resultados_edital` + agendador + painel.
4. API de pesquisa (+ camada privada) e e2e A x B.
5. Telas (pesquisa, cartão na calculadora, sugestão no resultado).

### 8.11 Decisões adotadas (2026-11-08)

1. **Janela e revisita:** **(a) 365 dias após encerramento, revisita a cada 7 dias**, parametrizado em `ops.fontes.parametros`, com prioridade para editais acompanhados.
2. **Cobertura:** **(a) editais já capturados em `pub.editais` neste bloco inicial**, com **(b) backfill de 12 meses em PR/SC** como item seguinte após medir volume e taxa.
3. **Permissão da pesquisa pública:** **`editais/visualizar`** (dado público em `pub` governado por `core.pode_ver_editais()`; camada privada exige `precos/ver_custos_margens`).
4. **Comparação "nosso preço × histórico":** **(a) não neste bloco inicial**, entrando a seguir em **(c) `rules/precos.py`** (100% de cobertura) para manter toda conta de preço em `rules/` (regra 15).
5. **Informação comercial privada:** **só nossa oferta, custo e margem exigem `precos/ver_custos_margens`**; vencedora e marca/modelo digitadas em `priv.resultados_item` seguem `agenda/visualizar` (Fase 09).
6. **Marca/modelo:** **aceitar busca pelo texto do item e pelos nossos registros quando o PNCP não trouxer estruturado** (extração de marca em atas/contratos fica para a Fase 13.5).

## 9. Bloco 7.4 · Cenários salvos de preço · **Rascunho**

- **Status deste bloco:** `Rascunho` em 2026-11-12 (Claude Code, Q-42). **Aguarda aprovação do Adriano** e as respostas de §9.11; nada aqui vira código antes disso.
- **Fontes:** Prompt Mestre 7.4 (cenários: preço inicial, preço-alvo, preço mínimo autorizado, preço após negociação, margem resultante; empate ficto ME/EPP e direito de nova oferta; risco de inexequibilidade parametrizado), 7.2, 7.3, 7.5 (sigilo "Ver custos e margens"), 7.6 (alçada, reautenticação e justificativa abaixo do mínimo), 8.2 (proposta final "atualiza o preço final"), 9.2 (valores inicial/final, melhor lance); plano, Fase 07 ("Cenários: inicial, alvo, mínimo autorizado, pós-negociação; simulação de empate ficto ME/EPP") e Onda 5 (`priv.cenarios_preco`); regras 14 e 15. Código conferido: `rules/precos.py` (`calcular`, `empate_ficto`), `worker/preco.py`, `priv.precificacoes`/`priv.preco_linhas` (migration `20261111100000`), `priv.aprovar_preco` com step-up `preco_abaixo_minimo` (migration `20261123100000`), `apps/api/src/precos/precos.controller.ts`, `features/precos/Calculadora.tsx`.

> **Princípios:** cenário é **o mesmo cálculo da precificação com outro preço unitário**, nunca outro conjunto de custos: as linhas de custo e os percentuais continuam sendo os de `priv.precificacoes` (um custo, uma verdade). Todo número de cenário (preço arredondado, total, margens, diferença para o estimado, abaixo do mínimo, inexequibilidade, empate ficto) sai de `rules/precos.py` em `Decimal` (regra 15, 100% de cobertura), gravado pelo worker; a API só grava o preço informado e enfileira. A IA não sugere cenário nem lance. O sistema **não dá lance** (regra 17): o "mínimo autorizado" é um limite interno para a pessoa que opera a sessão no portal.

### 9.1 Escopo

**Entra:**

- **Quatro cenários fixos por precificação** (Prompt 7.4): `inicial`, `alvo`, `minimo_autorizado` e `pos_negociacao`, cada um com o preço unitário informado e o resultado calculado (preço arredondado pela regra do edital, total, margem bruta, margem líquida, diferença para o estimado, abaixo do mínimo comercial, risco de inexequibilidade).
- **Cenário inicial preenchido a partir do preço aprovado** (o `preco_final_unit` que a proposta da Fase 08 já usa), editável enquanto não houver proposta final.
- **Aprovação do mínimo autorizado** com a alçada da 7.6: `precos/aprovar`; abaixo do mínimo comercial, justificativa (≥ 10 caracteres) e reautenticação (o mesmo step-up `preco_abaixo_minimo`, vinculado ao cenário).
- **Mudar insumo derruba a aprovação do cenário** (quantidade, linhas, percentuais, margens, casas, arredondamento): o cenário é recalculado e volta a "não aprovado", como já acontece com a precificação.
- **Simulação do empate ficto na tela** (fecha o 🟡 de §7): a pessoa informa a melhor oferta conhecida; `empate_ficto` diz se há direito de nova oferta, o valor-limite e se o mínimo autorizado permite cobrir a melhor oferta. Percentual sempre parâmetro (⚖️).
- **Pós-negociação** pré-preenchido com o valor final do resultado (Fase 09) quando ele existir, sempre confirmado pela pessoa; abaixo do mínimo autorizado gera alerta.
- **Histórico dos cenários** (auditoria): cada gravação de preço e cada aprovação fica no `audit` e o cenário guarda a "foto" dos insumos usados no cálculo (hash), para reproduzir o número depois.

**Não entra (e onde fica):**

| Item | Onde fica |
| --- | --- |
| Cenários livres ("e se o frete subir 10%?") com custos próprios | Pergunta 1 (recomendação: não; cenário só muda o preço) |
| Proposta final usando o cenário pós-negociação | Pergunta 5 (mexe na Fase 08; recomendação: item seguinte) |
| Alerta durante a sessão (lance chegando perto do mínimo autorizado) | Spec 09 §6 (alerta em tempo real); este bloco só expõe o número |
| Sugestão de lance, de preço ou de cenário pela IA ou pelo histórico (7.5) | Nunca (regra 15) |
| Robô de lance, leitura automática do lance do portal | Nunca (regra 17) |
| Alçada por faixa de valor/margem por papel | Pergunta 3 da §6 (continua `precos/aprovar`) |
| Parâmetros tributários e percentuais de empate/inexequibilidade validados | 🧾 contador / ⚖️ jurídico (§6, perguntas 1 e 2) |

### 9.2 Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-07.17 | Quatro cenários por precificação (inicial, alvo, mínimo autorizado, pós-negociação), no máximo um de cada tipo, com o preço unitário informado | 7.4, plano Fase 07 |
| RF-07.18 | O resultado de cada cenário (preço arredondado, total = quantidade × unitário arredondado, margem bruta, margem líquida, diferença para o estimado, abaixo do mínimo, risco de inexequibilidade) é calculado em `rules/precos.py` com os insumos da precificação | 7.2, 7.3, 7.4, regra 15 |
| RF-07.19 | Cenário guarda o hash dos insumos usados; mudar insumo recalcula todos os cenários e marca os aprovados como "aprovação derrubada" (com o motivo no histórico) | 7.3 "reproduzíveis e auditáveis", 7.6 |
| RF-07.20 | Mínimo autorizado só vale aprovado por `precos/aprovar`; abaixo do mínimo comercial exige justificativa e reautenticação vinculada ao cenário | 7.6 |
| RF-07.21 | Empate ficto: com `me_epp` e a melhor oferta informada, mostra se há direito de nova oferta, o valor-limite e se o mínimo autorizado cobre a melhor oferta; percentual é parâmetro da precificação, marcado "não validado" até o jurídico | 7.4, ⚖️ |
| RF-07.22 | Risco de inexequibilidade por cenário só com critério parametrizado; sem critério, "não parametrizado" | 7.4, regra 15 |
| RF-07.23 | Pós-negociação pode ser pré-preenchido com o valor final do resultado (Fase 09); nada é gravado sem ação humana; abaixo do mínimo autorizado gera alerta | 7.4, 9.2 |
| RF-07.24 | Custos e margens dos cenários só com `precos/ver_custos_margens`; o preço do mínimo autorizado aprovado, sem custo nem margem, conforme a pergunta 2 | 7.5 |
| RF-07.25 | Isolamento A x B da tabela e das rotas; dinheiro como texto decimal na API | regras 13 e 14 |

### 9.3 Modelo de dados

#### `priv.cenarios_preco`

| Coluna | Tipo | Nulo | Regra |
| --- | --- | --- | --- |
| id | uuid | não | v7, PK |
| empresa_id | uuid | não | FK `core.empresas` |
| precificacao_id | uuid | não | FK `(…, empresa_id)` → `priv.precificacoes` |
| tipo | text | não | `inicial`, `alvo`, `minimo_autorizado`, `pos_negociacao` |
| preco_informado_unit | numeric(18,6) | não | ≥ 0; o que a pessoa digitou (mesma precisão de `precificacoes.preco_*_unit`, que aceita 2 a 6 casas no unitário) |
| origem | text | não | `manual`, `preco_aprovado` (inicial), `resultado` (pós-negociação pré-preenchido e confirmado) |
| observacao | text | sim | ≤ 500 |
| melhor_oferta_unit | numeric(18,6) | sim | ≥ 0; só para a simulação do empate ficto (informada pela pessoa) |
| — resultado (só o worker grava) — | | | |
| preco_unit | numeric(18,6) | sim | arredondado pela regra do edital |
| total | numeric(18,4) | sim | quantidade × `preco_unit`, 2 casas |
| margem_bruta_pct, margem_liquida_pct, diferenca_estimado_pct | numeric(12,4) | sim | como em `precificacoes` |
| abaixo_do_minimo | boolean | sim | `preco_unit < preco_minimo_unit` da precificação |
| abaixo_do_autorizado | boolean | sim | só em `pos_negociacao`/`alvo`: `preco_unit <` mínimo autorizado aprovado |
| risco_inexequivel | text | sim | `OK`, `RISCO`, `NAO_PARAMETRIZADO` |
| empate_ficto | text | sim | `sem_direito`, `com_direito`, `nao_me_epp`, `sem_melhor_oferta` |
| empate_limite_unit | numeric(18,6) | sim | valor-limite do empate (sai de `empate_ficto`) |
| cobre_melhor_oferta | boolean | sim | só em `minimo_autorizado`: mínimo autorizado `<` melhor oferta |
| hash_insumos | text | sim | SHA-256 dos insumos da precificação no cálculo |
| erro_calculo | text | sim | ≤ 300 |
| calculado_em | timestamptz | sim | |
| — aprovação (só `minimo_autorizado`) — | | | |
| justificativa_abaixo | text | sim | ≤ 1000; obrigatória (≥ 10) se `abaixo_do_minimo` |
| aprovado_por, aprovado_em | uuid, timestamptz | sim | juntos (check) |
| created_at, updated_at, created_by, deleted_at | | | padrão |

**Mudanças em `priv.precificacoes` (migration nova):** `percentual_empate_pct numeric(9,4)` (≥ 0, ≤ 100; nulo = "não parametrizado"; a tela oferece o padrão do Prompt, 5% pregão e 10% demais, **marcado ⚖️ não validado**), usado junto do `me_epp` e do `modalidade_empate` que já existem.

**Checks:** `(aprovado_por is null) = (aprovado_em is null)`; `aprovado_em is null or tipo = 'minimo_autorizado'`; `melhor_oferta_unit is null or tipo in ('minimo_autorizado', 'alvo', 'pos_negociacao')`.
**Unicidade:** `(precificacao_id, tipo) where deleted_at is null`; `(id, empresa_id)`. **Índices:** `(empresa_id)`, `(precificacao_id)`.

**RLS:**

| Operação | Policy |
| --- | --- |
| select | `core.has_permission(empresa_id, 'precos', 'ver_custos_margens')` (a mesma de `precificacoes`) |
| insert / update / delete | nenhuma; só pelas funções abaixo |

**Funções (security definer, `search_path = ''`):**

- `priv.salvar_cenario_preco(p_empresa, p_precificacao, p_tipo, p_preco_unit, p_origem, p_melhor_oferta, p_observacao) returns uuid` — `precos/editar`; upsert por `(precificacao_id, tipo)`; zera o resultado e a aprovação do cenário; enfileira `calcular_preco` (o mesmo job recalcula a precificação e os cenários).
- `priv.aprovar_cenario_minimo(p_empresa, p_cenario, p_justificativa, p_step_up) returns void` — `precos/aprovar`; só cenário calculado sem erro e com `hash_insumos` igual ao atual; abaixo do mínimo comercial exige justificativa e `core.exigir_step_up(p_step_up, 'preco_abaixo_minimo', p_empresa, 'cenario:' || p_cenario)`.
- `priv.remover_cenario_preco(p_empresa, p_cenario)` — `precos/editar`; soft delete.
- `priv.piso_autorizado(p_empresa, p_participacao) returns numeric` — **só se a pergunta 2 for (b)**: `precos/visualizar`; devolve só o `preco_unit` do mínimo autorizado **aprovado e não derrubado**, ou nulo; nunca custo nem margem.
- As funções de insumo existentes (`salvar_parametros_preco`, `adicionar_linha_preco`, `remover_linha_preco`) passam a derrubar também a aprovação do mínimo autorizado (nova versão da função em migration nova).

Auditoria `audit.registrar()` em insert/update (`enable always`). Teste de isolamento A x B em `db/tests/isolamento/priv_cenarios_preco.test.sql`.

### 9.4 Regras

1. **Mesmo cálculo:** `calcular_cenario(entrada, preco_unit)` em `rules/precos.py` reaproveita `calcular` com `preco_proposto = preco_unit` (mesmas casas, modo de arredondamento, percentuais, estimado e limite de inexequibilidade). Divisor ≤ 0 continua recusado.
2. **Ordem esperada, só alerta (nunca bloqueio nem correção):** `inicial ≥ alvo ≥ minimo_autorizado` e `pos_negociacao ≥ minimo_autorizado`. Fora disso, aviso "cenários fora de ordem".
3. **Aprovação derrubada:** `hash_insumos` do cenário diferente do hash atual da precificação = aprovação derrubada (o worker grava o novo hash e limpa `aprovado_*`, registrando no histórico "insumo alterado").
4. **Empate ficto:** só com `me_epp = true`, `percentual_empate_pct` informado e `melhor_oferta_unit` informada; a função `empate_ficto` existente recebe os **totais** (`quantidade × unitário`), e o limite volta em unitário com a regra de arredondamento do edital (pergunta 4). Sem percentual: "não parametrizado". ⚖️ quem tem direito, em que ordem e com qual prazo para a nova oferta **não é decidido pelo sistema**; a tela só mostra a conta.
5. **Inexequibilidade:** `preco_unit < estimado × limite%`, com o limite já existente na precificação. ⚖️ critério por modalidade/objeto continua pergunta 2 da §6.
6. **Pós-negociação a partir do resultado:** a tela oferece "usar o valor final registrado" quando `priv.resultados_item.valor_final` existe; a pessoa confirma e o cenário grava `origem = 'resultado'`. Se o valor do resultado é total ou unitário, ver pergunta 4.
7. **Sigilo:** cenário inteiro (preço, margens, total) é sigilo comercial (`ver_custos_margens`). A exceção, se aprovada (pergunta 2), é só o número do mínimo autorizado aprovado.

### 9.5 Permissões (sugestão de padrão; a matriz é por vínculo)

| Operação | ADMIN_EMPRESA | OPERADOR | JURÍDICO | CLIENTE | Step-up |
| --- | --- | --- | --- | --- | --- |
| Ver cenários com margens (`precos/ver_custos_margens`) | sim | conforme vínculo | não | não | não |
| Salvar/remover cenário (`precos/editar`) | sim | conforme vínculo | não | não | não |
| Aprovar mínimo autorizado (`precos/aprovar`) | sim | não | não | não | só abaixo do mínimo comercial |
| Ver só o piso autorizado aprovado (`precos/visualizar`, se pergunta 2 = b) | sim | sim | não | não | não |

### 9.6 Jobs

| Job | Gatilho | Idempotência | Em caso de falha |
| --- | --- | --- | --- |
| `calcular_preco` (existente, ampliado) | qualquer função de insumo ou de cenário | o job recalcula tudo a partir do banco (resultado depende só dos insumos); mesmo hash = mesma saída | erro de um cenário vai para `erro_calculo` dele; a precificação continua; a tela mostra o erro, nunca um número antigo como atual |

Sem integração externa neste bloco.

### 9.7 API

| Rota | Permissão | Corpo | Resposta |
| --- | --- | --- | --- |
| `GET /empresas/:empresa/participacoes/:id/preco` (existente) | `precos/ver_custos_margens` (guard e RLS, como hoje) | — | passa a incluir `cenarios: [{ id, tipo, precoInformado, origem, observacao, melhorOferta, precoUnit, total, margemBruta, margemLiquida, diferencaEstimado, abaixoDoMinimo, abaixoDoAutorizado, riscoInexequivel, empateFicto, empateLimite, cobreMelhorOferta, desatualizado, erroCalculo, calculadoEm, aprovadoEm, aprovadoPor, justificativaAbaixo }]` e `avisos: ['fora_de_ordem']`; dinheiro sempre string |
| `POST /empresas/:empresa/precificacoes/:id/cenarios` | `precos/editar` | `{ tipo, precoUnit (texto decimal), origem?, melhorOferta?, observacao? }` | `202 { id, status: 'calculando' }`; `400` valor não decimal/negativo, tipo inválido; `404` precificação de outra empresa |
| `POST /empresas/:empresa/cenarios-preco/:id/aprovar` | `precos/aprovar` | `{ justificativa?, stepUp? }` | `204`; `400` não calculado, desatualizado, sem justificativa; step-up ausente ou de outro alvo recusado com a mesma resposta da aprovação atual (`aprovar_preco`); `404` |
| `DELETE /empresas/:empresa/cenarios-preco/:id` | `precos/editar` | — | `204`; `404` |
| `GET /empresas/:empresa/participacoes/:id/piso-autorizado` (só se pergunta 2 = b) | `precos/visualizar` | — | `{ piso: string \| null, aprovadoEm }` (nada de custo, margem ou outros cenários) |

### 9.8 Telas

| Tela | Rota | Estados | 360 px |
| --- | --- | --- | --- |
| Aba "Cenários" na calculadora | `/agenda/participacoes/:id/preco` | sem precificação calculada ("calcule o preço primeiro"); vazio (só o inicial sugerido); calculando; erro de cálculo por cenário; desatualizado ("insumo mudou: aprovação derrubada"); sem permissão (`ver_custos_margens`: aba oculta); aviso "fora de ordem"; selo ⚖️ no empate ficto e na inexequibilidade | um cartão por cenário (tipo, preço, total, margem líquida, selos), em coluna; editar abre folha com teclado decimal; tabela comparativa só ≥ 768 px |
| Aprovar mínimo autorizado | folha na aba | resumo (preço, margem, diferença para o mínimo comercial); abaixo do mínimo: justificativa + reautenticação (fluxo de step-up existente); recusado; aprovado | botões no rodapé fixo |
| Simulação do empate ficto | bloco dentro do cartão do mínimo autorizado | não ME/EPP (oculto); sem percentual ("não parametrizado"); sem melhor oferta; com direito / sem direito; "o mínimo autorizado cobre / não cobre a melhor oferta" | campo da melhor oferta em linha única |
| Pós-negociação | cartão | sem resultado registrado; com resultado ("usar o valor final registrado", a pessoa confirma); abaixo do autorizado (vermelho) | igual aos demais |

### 9.9 Critérios de aceite

| # | Critério | Como será comprovado |
| --- | --- | --- |
| CA-13 | Cada cenário reproduz exatamente o cálculo da precificação para o mesmo preço (sem float), com casos de borda de arredondamento e truncamento | pytest `rules/precos.py` (100%) |
| CA-14 | Alterar quantidade ou um custo recalcula todos os cenários e derruba a aprovação do mínimo autorizado | pytest com banco + pgTAP |
| CA-15 | Mínimo autorizado abaixo do mínimo comercial não é aprovado sem justificativa, sem `precos/aprovar` ou sem step-up do próprio cenário (step-up de outro cenário é recusado) | pgTAP + e2e |
| CA-16 | Empate ficto: com/sem direito e valor-limite conferidos à mão em casos conhecidos; sem percentual, "não parametrizado" | pytest + e2e |
| CA-17 | Pós-negociação vindo do resultado só é gravado com a confirmação; abaixo do autorizado gera o alerta | e2e + teste de tela |
| CA-18 | Sem `ver_custos_margens` nenhum cenário aparece; B nunca vê nem altera cenário de A (404) | pgTAP de isolamento + e2e A x B |
| CA-19 | (se pergunta 2 = b) a rota do piso devolve só o número aprovado, nunca custo/margem, e nulo quando a aprovação foi derrubada | e2e |

### 9.10 Ameaças (proposta para `docs/threat-model.md`)

| Ameaça | Controle | Teste |
| --- | --- | --- |
| **T1** · cenários de A (o piso de lance, a informação comercial mais sensível) vistos por B | RLS `ver_custos_margens` + `comContexto`; 404 sem revelar | CA-18 |
| **T1.3 (nova)** · piso de lance vaza dentro da empresa para quem não deveria ver margens | piso separado só com o número (pergunta 2), nunca margens; sem piso no push/e-mail | CA-19 |
| **T6** · operador usa um mínimo autorizado velho (custos mudaram) na sessão | hash dos insumos; aprovação derrubada ao mudar insumo; tela marca "desatualizado" | CA-14 |
| **T5.1b** · step-up de outra aprovação reaproveitado para aprovar o piso | step-up vinculado a `cenario:<id>` | CA-15 |
| **T14** · pressão para "dar lance até o piso" automaticamente | regra 17: nenhum job/rota fala com portal; o piso é só informação | revisão + e2e de rotas |

### 9.11 Perguntas abertas

1. **Cenários livres além dos quatro do Prompt?** (a) só os quatro fixos, mudando só o preço; (b) também até N simulações nomeadas com o mesmo cálculo; (c) simulações com custos próprios. **Recomendação: (a)**: cobre o 7.4 e mantém "um custo, uma verdade"; (b) entra depois se o uso pedir.
2. **Quem vê o mínimo autorizado na sessão?** (a) só quem tem `ver_custos_margens` (como todo o resto); (b) o número do piso aprovado também para `precos/visualizar`, sem custo nem margem; (c) também no painel da sessão (spec 09 §6) para quem tem `agenda/editar`. **Recomendação: (b)**: o piso existe para quem opera a sessão, que nem sempre deve ver margens; (c) só se o Adriano quiser o piso no painel da sessão.
3. **O inicial é sempre o preço aprovado?** (a) sim, preenchido do `preco_final_unit` aprovado e editável até a proposta final; (b) independente, digitado. **Recomendação: (a)**, evita dois "preços iniciais" diferentes entre preço e proposta.
4. **Base da disputa (unitário ou total) e do valor final do resultado.** O núcleo da Fase 09 não define se `valor_final`/`melhor_lance` são unitários ou totais. (a) campo `base_disputa` (`unitario`/`total`) na precificação, e o resultado segue a mesma base; (b) sempre unitário; (c) sempre total. **Recomendação: (a)**, porque editais variam (item × lote/global); ⚖️ o empate ficto compara a proposta "como julgada no edital".
5. **Proposta final (8.2) usa o pós-negociação?** (a) não neste bloco (a proposta final continua com o preço da precificação, que a pessoa ajusta); (b) sim: pós-negociação aprovado vira o preço da proposta final, com a mesma alçada e a mesma conferência de total. **Recomendação: (a) agora e (b) como item seguinte**, porque (b) mexe na geração e na validação da Fase 08.
6. ⚖️ **Empate ficto: percentuais, quem tem direito e prazo da nova oferta** (LC 123, arts. 44 e 45). Continua a pergunta 2 da §6: **parâmetro por precificação, preenchido e validado pelo jurídico**; o sistema só faz a conta.
7. 🧾 **Margem líquida por cenário** usa os mesmos percentuais sobre o preço (tributos) da precificação, ainda não validados pelo contador. **Recomendação:** mostrar o selo 🧾 "tributos não validados" no cartão enquanto alguma linha percentual não estiver validada.

### 9.12 Plano de entregas

1. `rules/precos.py`: `calcular_cenario`, ordem, empate com limite unitário, hash dos insumos; testes primeiro (100%). **Tier: médio · sem migration.**
2. Migration: `priv.cenarios_preco`, coluna `percentual_empate_pct`, funções (salvar, aprovar com step-up, remover; novas versões das funções de insumo que derrubam a aprovação); pgTAP + isolamento A x B. **Tier: alto (sigilo + step-up) · com migration.**
3. Job `calcular_preco` ampliado (cenários, derrubada de aprovação) + pytest com banco. **Tier: médio · sem migration.**
4. API (cenários no GET, 3 rotas, piso se pergunta 2 = b) + e2e A x B. **Tier: médio · sem migration.**
5. Tela (aba Cenários, aprovação, empate, pós-negociação) em 360 px e desktop. **Tier: médio · sem migration.**
