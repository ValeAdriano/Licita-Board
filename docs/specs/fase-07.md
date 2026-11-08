# Spec · Fase 07 · Formação de preços e viabilidade comercial

- **Status:** Aprovada em 2026-11-05 (instrução do Adriano: "siga desenvolvendo sem interrupções, uma fase após a outra"). Decisões abaixo são recomendações minhas, registradas para revisão.
- **Onda:** 5
- **Autor:** Claude Code (2026-11-05) · **Aprovação:** Adriano Vale, 2026-11-05
- **Validação:** **🧾 parâmetros tributários pendentes e bloqueantes para o uso real** (precisam do responsável contábil); **⚖️ regras de ME/EPP e de inexequibilidade pendentes do jurídico** (nada é suposto: tudo é parâmetro).
- **Fontes:** Prompt Mestre Fase 07 (7.1 a 7.6) e regras 14 e 15 do AGENTS.md; Fase 02 (`priv.produtos`); Fase 05 (`priv.participacoes`).
- **Bloco em rascunho:** 7.5 (§8), status `Rascunho` (Q-29, 2026-11-07), aguarda aprovação do Adriano; não altera o status `Aprovada` do restante.

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
| Cenários múltiplos salvos (inicial, alvo, mínimo autorizado, pós-negociação) | Entram junto da Fase 09 (disputa). Aqui há o preço mínimo, o de oferta e o proposto. |
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
- ❌ Histórico comercial de preços vencedores/integração de preços PNCP: não localizado em `apps/api/src/precos` nem `apps/worker/src/worker`.
- ❌ Cenários salvos: não localizados em `apps/api/src/precos` nem `apps/web/src/features/precos`.
- 🟡 Valor por extenso: utilitário existe na Fase 08, mas não integrado à tela de preços: `apps/worker/src/worker/rules/extenso.py`.
- ❌ Parâmetros tributários e percentuais de empate/inexequibilidade ainda aguardam validação do contador/jurídico; não há regra ativa que os determine.
- ✅ Q-23 (rodada 2): matriz e2e A x B das 7 rotas `:empresa`, nos dois sentidos, com 404 para empresa e id alheios, recurso da dona intacto e nenhum job criado pela tentativa. Suítes análises/preços: 15 testes verdes; pgTAP executado no banco descartável. Sigilo de custos/margens preservado nas respostas de preços; valores monetários como string.

- 2026-11-05 · spec aprovada; implementação em blocos (regras puras → banco → worker → API → tela).
- **Núcleo pronto (2026-11-05):** `rules/precos.py` (Decimal, 100% de cobertura, casos de borda de arredondamento), migration `20261111100000` (`priv.precificacoes`, `priv.preco_linhas`; leitura só com `precos/ver_custos_margens`; escrita só por função; alçada: abaixo do mínimo exige justificativa e `precos/aprovar`; mudar insumo derruba a aprovação), job `calcular_preco` (`worker/preco.py`), API `apps/api/src/precos`, tela `/agenda/participacoes/:id/preco` (link "Preço" nos itens). Testes: pytest (15 das regras, 5 do job com banco), pgTAP 270 e 2 de isolamento A x B, e2e (sigilo de custos e A x B), formatação do front. Conferido no navegador com o worker real (conta fictícia): preço = custo ÷ (1 − percentuais − margem), arredondado e total conferidos à mão.
- **Falta na Fase 07:** histórico comercial de preços vencedores (7.5), reautenticação ao aprovar abaixo do mínimo (7.6), cenários salvos (entram com a Fase 09), valor por extenso (Fase 08), **simulação do empate ficto na tela** (a função pura `empate_ficto` existe e é testada, mas não há endpoint nem campo para a melhor oferta), parâmetros tributários validados (🧾 contador) e percentuais do empate ficto/inexequibilidade (⚖️ jurídico).

## 8. Bloco 7.5 · Histórico comercial de preços vencedores · **Rascunho**

- **Status deste bloco:** `Rascunho` (Q-29, 2026-11-07, Claude). O resto da spec continua `Aprovada`. Nada deste bloco é implementado antes da aprovação do Adriano.
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
- `ops.fontes.parametros` do `pncp`: chave `resultados` com `janela_dias`, `revisita_dias`, `max_editais_por_execucao`, `horarios` (valores `<A DEFINIR>`; sugestão 365, 7, 200, `{03:00}`).

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

**Limites:** cliente HTTP existente (`pesquisa/http.py`): só https, só hosts permitidos, sem redirecionamento, `User-Agent` do robô, taxa por host compartilhada (2 req/s hoje), retry com espera progressiva, JSON lido com `Decimal`. Orçamento de pedidos por execução = `max_editais_por_execucao` × (1 + itens com resultado), com teto `<A DEFINIR>`.

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

### 8.11 Perguntas abertas

1. **Janela e revisita** — quanto tempo depois do encerramento continuar procurando resultado e de quanto em quanto tempo? Opções: (a) 365 dias, a cada 7 dias; (b) 180 dias, a cada 3 dias; (c) só editais acompanhados. **Recomendação: (a)**, parametrizado em `ops.fontes.parametros`, com prioridade para editais acompanhados.
2. **Cobertura** — o histórico cobre só os editais já capturados (PR/SC, desde o início da captura) ou fazemos backfill amplo (outras UFs, anos anteriores), que exige criar `pub.editais`/`pub.edital_itens` em volume? Opções: (a) só os capturados agora; (b) backfill de 12 meses em PR/SC; (c) backfill nacional. **Recomendação: (a) agora e (b) como item seguinte**, medindo volume e taxa antes; (c) vira decisão de custo.
3. **Permissão da pesquisa pública** — `editais/visualizar` (mesma regra de `pub.editais`) ou `precos/visualizar`? **Recomendação: `editais/visualizar`**, porque o dado é público e a RLS de `pub` já usa `core.pode_ver_editais()`; o que é sigiloso está na camada privada.
4. **Comparação "nosso preço × histórico"** — mostrar a diferença % entre o preço da calculadora e a mediana? Opções: (a) não neste bloco; (b) em SQL `numeric` na própria pesquisa; (c) no job `calcular_preco`, em `rules/precos.py` (100% de cobertura). **Recomendação: (c)**, para manter toda conta de preço em `rules/` (regra 15); até lá, (a).
5. **O que é "informação comercial privada"** — a vencedora e a marca/modelo que **nós** digitamos em `priv.resultados_item` (hoje visíveis com `agenda/visualizar`) entram na camada privada com `ver_custos_margens`, ou só nossa oferta, custo e margem? **Recomendação:** só oferta, custo e margem exigem `ver_custos_margens`; vencedora/marca digitadas seguem a permissão atual da agenda (não muda o que já foi aprovado na Fase 09).
6. **Marca/modelo** — se o PNCP não trouxer marca/modelo estruturado, aceitar que a busca por marca dependa do texto do item e dos nossos registros? Alternativa: extrair marca da ata/contrato com IA (custo, evidência, Fase 13.5). **Recomendação:** aceitar agora; extração fica para 13.5.
