# Spec · Fase 02 · Cadastro multiempresa, representantes e produtos

- **Status:** Aprovada em 2026-11-04 (com todas as recomendações da seção 11). Pendências de terceiros que **não bloqueiam o início**: lista de poderes e regra de procuração (jurídico VV, ⚖️) antes do PR 5; portes e regimes revisados pelo contador (🧾)
- **Onda:** 2 — MVP
- **Autor:** Claude Code (2026-11-04) · **Aprovação:** Adriano Vale, 2026-11-04 ("Aprovo, siga")
- **Validação jurídica:** pendente (poderes de representantes e procurações, ⚖️ seção 4) · **Validação contábil:** pendente (porte, enquadramento e regime tributário, 🧾 seção 4)
- **Fontes:** Prompt Mestre Fase 02 (2.1 a 2.5); Plano, Fase 02 e "Modelo de dados núcleo e RLS"; ADR-003, ADR-013 (duas camadas), ADR-017 (criptografia de campo); [Fase 01](fase-01.md) (relatório em `docs/phase-reports/fase-01.md`)

> Esta spec parte do estado real da Fase 01: `core.empresas` hoje só tem razão social, nome fantasia, CNPJ e `ativo`; o schema `pub` existe sem tabelas; o schema `priv` não tem nenhuma tabela. **Esta é a primeira fase com tabelas em `priv`**, então é nela que o teste de isolamento A x B por tabela (regra 13) passa a valer de verdade.

## 1. Escopo

**Entra:**

- Ficha completa da empresa (Prompt 2.1), com contatos, CNAEs, enquadramento com data de referência, dados bancários e PIX cifrados em campo.
- Representantes legais, procuradores e advogados (OAB), procurações com poderes e validade, e a função `core.signatario_valido(representante, data, poder)` que bloqueia signatário vencido (Prompt 2.2).
- Cifra de campo em envelope (ADR-017) na API, com vetores de teste, usada por PIX, conta bancária e CPF.
- Catálogo universal: categorias, atributos tipados com unidade, unidades com fator de conversão, seed de veículos (Prompt 2.3).
- Produtos por empresa, com dados comerciais segregados e atributos técnicos tipados; modelos do catálogo técnico compartilháveis entre empresas (Prompt 2.3 e 2.4).
- Fichas técnicas versionadas (Prompt 2.4).
- Palavras-chave por empresa (Prompt 2.5).
- Telas de tudo isso (mobile-first) e os testes A x B por tabela e por endpoint.

**Não entra (e onde fica):**

- Upload de arquivos (catálogo em PDF, procuração, assinatura digitalizada, ficha técnica em arquivo): Fase 03. Aqui os registros têm `documento_id` **nulo e sem FK**, que a Fase 03 liga.
- Alertas de procuração ou ficha a vencer na agenda: Fase 03 (certidões) e Fase 05 (agenda). Aqui só o campo e a validação.
- Pontuação de relevância usando as palavras-chave, e a regra "exclusão só reduz nota": Fase 04 (captura). Aqui só o cadastro.
- Comparação automática de atributos com exigência de edital: Fase 06 (aqui só os tipos e as unidades que a tornam possível).
- Preços, margens e propostas: Fases 07 e 08. Preço de custo e de referência do produto são **dados cadastrais** aqui; a formação de preço é outra coisa.
- Importação em massa de produtos (planilha): depois do MVP (pergunta 13).

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-02.1 | Empresa com razão social, nome fantasia, CNPJ validado (app, API e banco), inscrições estadual e municipal, CNAE principal e secundários, endereço completo, telefones, WhatsApp, e-mails, observações. ID interno UUID | Prompt 2.1 |
| RF-02.2 | Porte e enquadramento ME/EPP **com data de referência** e histórico; regime tributário | Prompt 2.1; ⚖️ 🧾 |
| RF-02.3 | Dados bancários e PIX cifrados em campo, exibidos mascarados; ver o valor inteiro fica auditado | Prompt 2.1, 1.4; ADR-017 |
| RF-02.4 | Vários representantes e procuradores por empresa, com identificação, qualificação, cargo, poderes; advogados com OAB | Prompt 2.2 |
| RF-02.5 | Procurações com poderes, emissão, validade, revogação; documento ligado na Fase 03 | Prompt 2.2 |
| RF-02.6 | `core.signatario_valido(representante, data, poder)`: bloqueia signatário sem poder ou com procuração vencida **na data do documento** | Prompt 2.2; critério de aprovação |
| RF-02.7 | Categorias e atributos configuráveis, sem migration para criar atributo novo; tipos número, texto, lista e sim/não; unidade padronizada | Prompt 2.3 |
| RF-02.8 | Unidades com fator de conversão (cv↔kW, GB↔TB, mm↔m) e conversão exata em decimal | Prompt 2.3; Plano |
| RF-02.9 | Produto da empresa com os campos gerais do Prompt 2.3 e atributos técnicos tipados; dados comerciais segregados por empresa | Prompt 2.3; critério |
| RF-02.10 | Modelo do catálogo técnico compartilhável entre empresas (fabricante, modelo, versão, ano) sem dado comercial; produto da empresa aponta para ele | Prompt 2.3, 2.4; critério |
| RF-02.11 | Fichas técnicas vinculadas a fabricante, produto, modelo, versão, ano, data de emissão, fonte oficial e situação de validade; versões anteriores preservadas; descontinuado identificado | Prompt 2.4; critério |
| RF-02.12 | Palavras-chave, sinônimos, categorias, marcas, modelos, termos relacionados, termos de exclusão, UFs, municípios, faixas de valor e restrições por empresa | Prompt 2.5 |
| RF-02.13 | Seed de atributos de veículos (motorização, potência, torque, combustível, tração, câmbio, dimensões, capacidade, equipamentos, garantia, homologação) | Plano, Fase 02 |
| RF-02.14 | Cifra de campo em envelope, com vetores de teste, usada pela API para PIX, conta e CPF | ADR-017 |
| RF-02.15 | Isolamento A x B em cada tabela nova de `priv` e `core` e em cada endpoint novo; dinheiro em `numeric(18,4)` e `string` | AGENTS.md regras 13 e 14 |

## 3. Modelo de dados

Convenções (AGENTS.md §7, `db/AGENTS.md`): `id uuid` v7, `empresa_id uuid not null` com FK composta onde houver filho, `created_at`, `updated_at`, `created_by`, `deleted_at` (soft delete), RLS na mesma migration, policies por operação via `core.has_permission`, grants explícitos, auditoria com redação dos campos pessoais e cifrados, `-- migrate:down` executável. Dinheiro `numeric(18,4)`. O que segue lista só o que é específico; a proposta é de **uma migration por assunto** (seção 10).

### 3.1 Empresa (core)

`core.empresas` ganha colunas (alteração de tabela existente: **migration nova**, nunca edição da antiga):

| Coluna | Tipo | Regra |
| --- | --- | --- |
| inscricao_estadual, inscricao_municipal | text | opcionais; formato livre com limite de tamanho (formatos variam por UF: pergunta 5) |
| cnae_principal | text | 7 dígitos, `check` de formato; validade contra a tabela CNAE só se decidirmos carregá-la (pergunta 4) |
| logradouro, numero, complemento, bairro, municipio | text | `municipio` livre + `municipio_ibge` opcional (pergunta 6) |
| uf | text | 2 letras, `check` na lista das 27 UFs |
| cep | text | 8 dígitos, `check` de formato |
| regime_tributario | text | `check` em lista fechada ⚖️🧾 (pergunta 3); nulo até informado |
| observacoes | text | até 4000 caracteres |

Tabelas filhas (todas com `empresa_id`, FK composta `(empresa_id, id)` e RLS por empresa):

| Tabela | Conteúdo | Regras |
| --- | --- | --- |
| `core.empresa_cnaes` | CNAEs secundários (`cnae`; a lista é ordenada pelo código) | único por empresa e CNAE |
| `core.empresa_contatos` | `tipo` (`telefone`, `whatsapp`, `email`), `valor`, `rotulo`, `principal` | no máximo um principal por empresa e tipo; e-mail e telefone com `check` de formato; **dado pessoal: redigido na auditoria** |
| `core.empresa_enquadramentos` | `porte` (`MEI`, `ME`, `EPP`, `DEMAIS`: pergunta 3), `data_referencia date not null`, `fonte` (`declaracao`, `certidao_junta`, `outra`), `observacao`; **uma linha por data** | só INSERT (histórico); o "atual" é a linha de maior `data_referencia` ≤ hoje; a função `core.enquadramento_em(empresa, data)` devolve o vigente em uma data (usada pelas Fases 05 e 08) |
| `core.empresa_contas` | `banco` (código COMPE), `agencia`, `conta`, `tipo_conta`, `titular_nome`, `titular_documento`, `pix_tipo` (`cpf`, `cnpj`, `email`, `telefone`, `aleatoria`), `pix_chave`, `principal` | **`agencia`, `conta`, `titular_documento` e `pix_chave` cifrados em envelope** (`jsonb` `{v, dek, iv, ct}`, ADR-017); a API devolve **máscara** (ex.: `•••• 1234`); `pix_chave_hash` (HMAC com chave própria) só para detectar duplicidade sem decifrar |

**RLS:** `select` com `empresas/visualizar`; escrita com `empresas/editar`; **conta e PIX exigem também step-up** (seção 5). Nenhum `delete` físico (soft delete). `vv_api` não lê as colunas cifradas por `select` direto: leitura mascarada por função `security invoker` e revelação por endpoint auditado (pergunta 8).

### 3.2 Representantes e procurações (core)

| Tabela | Colunas principais | Regras |
| --- | --- | --- |
| `core.representantes` | `empresa_id`, `tipo` (`SOCIO_ADMINISTRADOR`, `PROCURADOR`, `ADVOGADO`), `nome`, `cpf` (cifrado), `cpf_hash` (HMAC, único por empresa), `rg`, `orgao_expedidor`, `nacionalidade`, `estado_civil`, `profissao`, `cargo`, `email`, `telefone`, `oab_numero`, `oab_uf`, `assinatura_documento_id` (nulo até a Fase 03), `ativo` | OAB **obrigatória** se `tipo = 'ADVOGADO'`, proibida nos demais; CPF validado por dígito verificador (app, API e banco); **dado pessoal e CPF redigidos na auditoria** |
| `core.representante_poderes` | `representante_id`, `poder` | lista fechada de poderes (pergunta 2, ⚖️): `assinar_proposta`, `assinar_declaracoes`, `interpor_recurso`, `firmar_contrato`, `receber_intimacoes`, `peticionar`, `<A DEFINIR com o jurídico>`; único por par |
| `core.procuracoes` | `representante_id`, `numero`, `outorgante_documento` (o CNPJ da empresa), `data_emissao`, `data_validade` (nula = prazo indeterminado, ⚖️), `substabelecida_de` (nula), `revogada_em`, `documento_id` (nulo até a Fase 03), `observacao` | `data_validade ≥ data_emissao`; revogação só com `revogada_em` (nunca apagar); histórico preservado |
| `core.procuracao_poderes` | `procuracao_id`, `poder` | mesma lista fechada |

**`core.signatario_valido(p_representante uuid, p_data date, p_poder text) returns boolean`** (`stable`, `security invoker`): verdadeiro só se o representante está ativo e **(a)** é `SOCIO_ADMINISTRADOR` com o `poder` em `representante_poderes`, ou **(b)** existe procuração não revogada na `p_data`, com `data_emissao ≤ p_data` e (`data_validade is null` ou `p_data ≤ data_validade`), que inclui o `poder`. Regra de data sem fuso escondido: o documento traz a **data de referência** (America/Sao_Paulo) e a função compara `date` com `date`. A mesma função é a única fonte da regra: o banco a usa em `check`/gatilho de qualquer documento que registrar signatário (a partir da Fase 05), a API a expõe e o front só mostra o resultado.

### 3.3 Catálogo e produtos

| Tabela | Schema | Colunas principais | Quem escreve |
| --- | --- | --- | --- |
| `pub.unidades` | pub | `simbolo` (único), `grandeza` (`potencia`, `massa`, `comprimento`, `volume`, `dados`, `tempo`, `contagem`...), `fator_para_base numeric(30,12)`, `deslocamento numeric(30,12) default 0` (para unidades com offset, como °C), `base` boolean | SUPERADMIN (pergunta 1) |
| `pub.categorias` | pub | `slug`, `nome`, `pai_id` (árvore), `ordem` | SUPERADMIN |
| `pub.atributos_def` | pub | `categoria_id`, `slug`, `nome`, `tipo` (`numero`, `texto`, `lista`, `booleano`), `grandeza` (nula se não for número com unidade), `unidade_padrao_id`, `opcoes jsonb` (só para `lista`), `obrigatorio`, `ordem` | SUPERADMIN. **Atributo novo = linha nova, sem migration** (critério de aceite) |
| `pub.modelos` | pub | `categoria_id`, `fabricante`, `marca`, `modelo`, `versao`, `ano_modelo`, `descontinuado_em` | SUPERADMIN (curadoria; sem dado comercial) |
| `pub.modelo_atributos` | pub | `modelo_id`, `atributo_id`, `valor_numero numeric(30,12)`, `valor_texto`, `valor_booleano`, `unidade_id` | SUPERADMIN. Um só `valor_*` preenchido, conforme o tipo do atributo (`check`) |
| `priv.produtos` | priv | `empresa_id`, `modelo_id` (nulo se o produto não está no catálogo), `categoria_id`, `subcategoria_id`, `codigo_interno` (único por empresa), `marca`, `modelo`, `versao`, `descricao`, `unidade_fornecimento_id`, `preco_custo numeric(18,4)`, `preco_referencia numeric(18,4)`, `prazo_entrega_dias`, `garantia_meses`, `disponibilidade`, `fornecedor`, `status_comercial` (`ativo`, `suspenso`, `descontinuado`), `catalogo_documento_id`/`ficha_documento_id` (nulos até a Fase 03) | usuários com `produtos/cadastrar` e `produtos/editar` |
| `priv.produto_atributos` | priv | `empresa_id`, `produto_id`, `atributo_id`, mesmos `valor_*` e `unidade_id` | idem; sobrescreve o valor do `pub.modelo_atributos` quando existir (a Fase 06 lê o da empresa e, se faltar, o do modelo) |
| `priv.fichas_tecnicas` | priv | `empresa_id`, `produto_id`, `modelo_id`, `versao_ficha int`, `fabricante`, `modelo`, `versao_produto`, `ano`, `data_emissao`, `fonte_oficial`, `documento_id` (nulo até a Fase 03), `situacao` (`vigente`, `vencida`, `substituida`, `descontinuada`), `valida_ate` | **só INSERT** de nova versão; a anterior passa a `substituida` por função; nunca `update` do conteúdo (histórico preservado) |
| `priv.palavras_chave` | priv | `empresa_id`, `tipo` (`palavra`, `sinonimo`, `categoria`, `marca`, `modelo`, `relacionado`, `exclusao`), `termo`, `termo_normalizado`, `grupo_id` (liga sinônimos ao termo), `ativo` | `produtos/editar` (pergunta 7: módulo próprio?) |
| `priv.palavras_chave_filtros` | priv | `empresa_id`, `tipo` (`uf`, `municipio`, `faixa_valor`, `restricao`), `uf`, `municipio`, `valor_min numeric(18,4)`, `valor_max numeric(18,4)`, `texto` | idem |

**RLS (resumo):** `priv.*` e as filhas de `core` por `core.has_permission(empresa_id, <modulo>, <ação>)` (`select`→`visualizar`; `insert`→`cadastrar`; `update`→`editar`; `delete` só por soft delete com `arquivar`), `with check` igual ao `using` (impede mover linha para outra empresa), FK composta `(empresa_id, produto_id)` que impede produto de A ligado a atributo de B. **`pub.*` é legível por `vv_api` e escrito por função `security definer` restrita a SUPERADMIN** (pergunta 1); nenhum dado comercial em `pub`. **Dado comercial (`preco_custo`, `preco_referencia`, fornecedor) mora só em `priv.produtos`**, então "produto em duas empresas" são duas linhas de `priv.produtos` que apontam para o mesmo `pub.modelos`; o custo de uma nunca aparece na outra por construção.

**Índices:** `empresa_id` em toda tabela de `priv`; `(empresa_id, codigo_interno)` único; `(empresa_id, termo_normalizado)` em palavras-chave; `pub.modelos (fabricante, modelo, versao)` único; busca por texto (`pg_trgm` no schema `extensions`) em `produtos.descricao` e `modelos` (extensão nova no `db/init`: pergunta 12).

## 4. Regras de negócio

1. **CNPJ inválido é bloqueado** nos três níveis (formulário, API e `core.cnpj_valido` no banco, que já existe). CPF de representante segue o mesmo padrão com função `core.cpf_valido` (nova).
2. **Dados bancários e PIX**: cifrados antes de chegar ao banco (ADR-017); a API só devolve máscara; revelar o valor inteiro exige permissão e fica em `audit`; alterar conta ou PIX exige step-up e gera **notificação para os administradores da empresa** (vetor clássico de fraude de pagamento).
3. ⚖️ **VALIDAR JURÍDICO — poderes:** a lista fechada de poderes e quais poderes cada tipo de documento exige (proposta, declarações, recurso, contrato, impugnação, esclarecimento). Hoje: `<A DEFINIR>`. Não invento.
4. ⚖️ **VALIDAR JURÍDICO — procuração:** `data_validade` nula significa "prazo indeterminado" ou "inválida sem prazo"? Substabelecimento: a validade de quem substabelece limita a do substabelecido? Procuração para vários poderes com validades diferentes. Hoje `<A DEFINIR>`; até a resposta, a função trata `data_validade is null` como **inválida** (falha segura) e exige a validade.
5. ⚖️🧾 **VALIDAR — porte e enquadramento:** lista de portes (inclui `MEI`? médio e grande?), de regimes tributários, e a regra de que o enquadramento vale pela **data de referência** informada (não pela data de hoje). A fase guarda o histórico e a função `enquadramento_em(empresa, data)`; a aplicação da regra (benefícios da LC 123) é das Fases 05 e 08.
6. **Atributo tipado:** o tipo decide qual `valor_*` pode ser preenchido (`check`); lista só aceita valor de `opcoes`; número com `grandeza` exige unidade da mesma grandeza.
7. **Conversão de unidade em decimal:** `valor_base = valor * fator_para_base + deslocamento`; a conversão entre duas unidades da mesma grandeza usa o decimal exato do banco (`numeric`), nunca `float`; recusa grandezas diferentes. Vetores de teste: 1 kW = 1,359 62 cv (CV métrico: fator `<A DEFINIR com a engenharia>`), 1 TB = 1000 GB ou 1024 GiB conforme a unidade escolhida (decimal e binária são **unidades diferentes**: `GB` e `GiB`).
8. **Ficha técnica é histórico:** nova versão não altera a anterior; a vigente é a de maior `versao_ficha` com `situacao = 'vigente'`; `valida_ate` vencida muda a situação para `vencida` por consulta (não por job). Produto descontinuado mantém as fichas.
9. **Termos de exclusão nunca eliminam oportunidades** (Prompt 2.5): aqui só se cadastram; a regra de pontuação é da Fase 04.
10. **Soft delete e unicidade:** `deleted_at` não nulo libera o `codigo_interno` e o termo para reuso (índice único parcial `where deleted_at is null`).
11. Texto livre de terceiro (descrição de produto vinda de fornecedor, nome de empresa) é **dado, nunca instrução**, e é mostrado como texto (regra 16).

## 5. Permissões

Usa os módulos que já existem em `core.modulos` (`empresas`, `representantes`, `produtos`). CLIENTE só recebe `visualizar` (regra do banco).

| Operação / tela | SUPERADMIN | ADMIN_EMPRESA | OPERADOR | JURÍDICO | CLIENTE | Step-up |
| --- | --- | --- | --- | --- | --- | --- |
| Ver ficha da empresa (dados gerais, contatos, enquadramento) | todas | `empresas/visualizar` | idem | idem | idem | — |
| Editar dados gerais e contatos | todas | `empresas/editar` | se concedido | — | — | — |
| Registrar enquadramento | todas | `empresas/editar` | se concedido | — | — | — |
| Ver conta bancária e PIX (**mascarado**) | todas | `empresas/visualizar` | se concedido | — | — | — |
| Revelar conta e PIX inteiros | todas | `empresas/editar` | se concedido | — | — | **sim**, auditado |
| Criar ou alterar conta e PIX | todas | `empresas/editar` | se concedido | — | — | **sim** (`dados_bancarios`, escopo novo) + aviso aos administradores |
| Ver representantes e procurações (CPF mascarado) | todas | `representantes/visualizar` | idem | idem | idem | — |
| Revelar CPF | todas | `representantes/editar` | se concedido | se concedido | — | **sim**, auditado |
| Criar e editar representante, poderes, procuração | todas | `representantes/cadastrar` e `editar` | se concedido | se concedido | — | — |
| Consultar `signatario_valido` | todas | `representantes/visualizar` | idem | idem | idem | — |
| Ver catálogo (`pub.*`) | todas | qualquer usuário autenticado | idem | idem | idem | — |
| Criar e editar categorias, atributos, unidades, modelos | **só SUPERADMIN** | — | — | — | — | — |
| Ver produtos, atributos e fichas da empresa | todas | `produtos/visualizar` | idem | idem | idem | — |
| Criar e editar produto, atributos, ficha | todas | `produtos/cadastrar` e `editar` | se concedido | — | — | — |
| Ver custo e preço de referência | todas | `precos/ver_custos_margens`? (pergunta 9) | se concedido | — | — | — |
| Arquivar produto, representante, procuração | todas | `arquivar` do módulo | se concedido | — | — | — |
| Palavras-chave e filtros | todas | `produtos/editar` (pergunta 7) | se concedido | — | — | — |

"Se concedido" = a pessoa da equipe recebeu a permissão na matriz. Operação nova de step-up: o escopo `dados_bancarios` entra em `core.step_up_tokens` por migration (a lista de escopos hoje é fechada).

## 6. Telas

Mobile-first (360 px; abaixo de 768 px, cards em vez de tabela e ação primária fixa embaixo). Estados de toda tela: carregando, vazio, erro, sem permissão, sucesso. Recurso fora da fase aparece como **EM DESENVOLVIMENTO**. Nome de empresa, fornecedor e descrição são exibidos como texto.

| Tela | Conteúdo |
| --- | --- |
| Empresa (ficha) | Seções: dados gerais, endereço, contatos, enquadramento (linha do tempo com data de referência), contas e PIX (mascarados; "Revelar" pede step-up) |
| Representantes | Lista com tipo e situação do poder; formulário; procurações com validade e poderes; indicador "válido hoje" vindo de `signatario_valido` |
| Produtos | Lista com busca e filtro por categoria e status; formulário com atributos que mudam conforme a categoria (tipos e unidades vêm de `pub.atributos_def`); aba de fichas técnicas com histórico |
| Catálogo técnico (SUPERADMIN) | Categorias, atributos, unidades e modelos |
| Palavras-chave | Termos por tipo, sinônimos agrupados, exclusões destacadas, UFs, municípios, faixa de valor |

## 7. Jobs e integrações

Nenhum job novo é necessário na Fase 02. A notificação de alteração de conta/PIX usa `core.notificacoes` pela mesma função que o convite usa (enfileirando e-mail pelo worker, como os alertas de segurança da Fase 01). Nenhuma integração externa (consulta de CNPJ na Receita fica de fora: pergunta 10).

## 8. Ameaças

| Ameaça | Como a fase toca | Controle e teste |
| --- | --- | --- |
| **T1** concorrente vê dado de outra empresa | Toda tabela nova de `priv` e as filhas de `core` | pgTAP A x B por tabela em `db/tests/isolamento/` (o CI já falha sem); e2e A x B por endpoint; FK composta contra produto/atributo cruzado |
| **T1.2 (nova)** custo de A visível a B por produto compartilhado | Modelo do catálogo é compartilhado | Dado comercial só em `priv.produtos`; teste: duas empresas com o mesmo `modelo_id`, B não vê custo nem produto de A; `pub.*` sem coluna comercial (guarda no pgTAP) |
| **T4** vazamento de dado sensível | PIX, conta, CPF | Cifra em envelope (ADR-017) com vetores de teste; máscara por padrão; revelar auditado; `audit.registrar` redige colunas cifradas e pessoais (teste: nem o `old_data` nem o `new_data` trazem o valor); log sem o valor (formatter e teste) |
| **T4.c (nova)** chave-mestra ou HMAC de duplicidade permite adivinhar CPF/PIX | `cpf_hash` e `pix_chave_hash` | HMAC com chave separada da KEK; CPF tem pouco espaço de busca: o hash **não é exposto** a `vv_api` por `select` (só dentro de função de unicidade) e o teste confere o grant |
| **T5.38 (nova)** troca de PIX por conta comprometida desvia pagamento | Alterar conta | Step-up `dados_bancarios` + aviso aos administradores + auditoria |
| **T6** erro humano: CNPJ errado, signatário vencido | RF-02.1, RF-02.6 | Validação em três camadas; testes de borda de data (véspera, dia da validade, dia seguinte, revogada, ainda não emitida) |
| **T3** texto de terceiro como instrução | Descrição de produto, nome de fornecedor | Exibidos como texto; nunca viram instrução (nada de IA nesta fase) |
| **T2** operador mexe onde não deve | Permissões por módulo | pgTAP por ação (positivo e negativo) e e2e do OPERADOR sem a permissão |

## 9. Critérios de aceite

Os do Prompt Mestre, mais os do Plano, cada um com a prova.

| # | Critério | Como será comprovado |
| --- | --- | --- |
| CA-1 | Empresa cadastra múltiplos produtos e representantes | e2e: uma empresa com 3 produtos e 3 representantes, listagem e edição; vitest da tela |
| CA-2 | Novo atributo sem alterar a estrutura central (sem migration) | e2e/pgTAP: SUPERADMIN cria `pub.atributos_def` em tempo de execução e a empresa grava valor tipado nele; `git diff` mostra zero migration para isso |
| CA-3 | Produto associado a várias empresas, com informações comerciais segregadas | pgTAP e e2e A x B: mesmo `modelo_id` em A e B, custo e preço de A invisíveis para B, em `select`, `update` e pelo endpoint |
| CA-4 | Documento técnico permanece vinculado ao modelo e à versão corretos | pgTAP: nova versão de ficha preserva a anterior; `update` do conteúdo recusado; a vigente é a certa |
| CA-5 | CNPJ inválido é bloqueado | pgTAP + e2e + vitest (já cobre o numérico e o alfanumérico; estende ao cadastro completo) |
| CA-6 | Signatário com poderes ou procuração vencidos é bloqueado | pgTAP `signatario_valido` com as bordas de data (4.3 e 4.4) e e2e do endpoint |
| CA-7 | Dado bancário e PIX cifrados em campo, mascarados e auditados | Teste: o valor não aparece em `select` direto como `vv_api`, nem na auditoria, nem no log; vetores de cifra; e2e de "revelar" auditado |
| CA-8 | Conversão de unidade exata | pgTAP com os vetores da regra 7 (decimal, sem `float`) |
| CA-9 | Toda tabela nova de `priv` e `core` tem A x B; todo endpoint novo tem e2e A x B | Q-23 rodada 9: matriz bidirecional das 21 rotas de ficha (11), contas/PIX (5) e representantes (5), fixtures por caso, ID alheio pela empresa própria, comparação com UUID inexistente e estado intacto; 66 e2e verdes nas três suítes. Q-23 rodada 10: matriz bidirecional das 26 rotas de produtos (12), procurações/poderes (8) e palavras-chave/filtros (6), fixtures próprias por caso, comparação com UUID inexistente e hashes do estado intacto (incluindo CPF cifrado e vínculos documentais); POST de procuração com representante alheio pela empresa própria retorna 400 indistinguível de UUID inexistente. Validação em banco limpo: 118/118 e2e nas três suítes (52 casos novos), lint e typecheck verdes. URLs/download de arquivos pertencem ao módulo de documentos e ficam fora desta rodada. `scripts/check_isolation_coverage.py` para tabelas. |
| CA-10 | Persistência: dados continuam após sair e entrar | e2e (como o da Fase 01) estendido |

## 10. Plano de PRs (cada um < 500 linhas por commit)

1. `feat/fase-02-empresa-completa`: migration das colunas, contatos, CNAEs, enquadramentos (+ `enquadramento_em`) + pgTAP + API (`GET/PATCH /empresas/:id` ampliado, sub-recursos) + e2e A x B.
2. `feat/fase-02-cifra-campo`: biblioteca de cifra em envelope na API com vetores de teste (e escolha do formato compatível com o worker, ADR-017) + HMAC de duplicidade; sem tabela ainda.
3. `feat/fase-02-contas-pix`: `core.empresa_contas`, escopo de step-up `dados_bancarios`, máscara, revelar auditado, aviso aos administradores + pgTAP + e2e.
4. `feat/fase-02-representantes`: `core.representantes`, poderes, `cpf_valido` + pgTAP + API + e2e.
5. `feat/fase-02-procuracoes-signatario`: procurações e `signatario_valido` com as bordas de data + pgTAP + e2e.
6. `feat/fase-02-catalogo`: `pub.unidades`, `categorias`, `atributos_def`, `modelos`, `modelo_atributos`, conversão, seed de veículos + pgTAP + API (leitura para todos, escrita SUPERADMIN).
7. `feat/fase-02-produtos`: `priv.produtos` e `produto_atributos` + A x B + API + e2e (inclui CA-2 e CA-3).
8. `feat/fase-02-fichas-tecnicas`: `priv.fichas_tecnicas` versionadas + pgTAP + API.
9. `feat/fase-02-palavras-chave`: `priv.palavras_chave` e filtros + A x B + API.
10. `feat/fase-02-app-empresa-representantes`, `feat/fase-02-app-produtos`, `feat/fase-02-app-catalogo-palavras`: telas (3 PRs) + vitest.
11. `docs/relatorio-fase-02`: relatório com evidências reais e remoção do que ficar obsoleto.

PRs 1 a 9 mexem em `db/migrations/`: **um agente por vez** (AGENTS.md §10), em sequência. As telas (10) podem andar em paralelo depois de cada API.

## 11. Perguntas abertas (com a minha recomendação)

1. **Quem escreve o catálogo compartilhado (`pub.*`: unidades, categorias, atributos, modelos)?** O esquema da Fase 01 diz que `pub` é escrito só pelo worker. *Recomendo:* SUPERADMIN pela API, por funções `security definer` estreitas (o worker continua sendo o dono de `pub` nas fases de captura). Alternativa: só o worker, o que obriga a carregar o catálogo por arquivo/seed.
2. ⚖️ **Lista de poderes** (`assinar_proposta`, `assinar_declaracoes`, `interpor_recurso`, `firmar_contrato`, `receber_intimacoes`, `peticionar`...) e **quais poderes cada documento exige**. *Recomendo:* o jurídico VV entrega a tabela antes do PR 5; até lá o PR 4 sobe sem poderes tipados.
3. ⚖️🧾 **Portes e regimes aceitos** (`MEI`, `ME`, `EPP`, `DEMAIS`? e `SIMPLES`, `LUCRO_PRESUMIDO`, `LUCRO_REAL`, `MEI`?). *Recomendo:* lista acima como `check`, revisada pelo contador, e a regra de uso na data de referência fica para as Fases 05 e 08.
4. **Tabela CNAE** (cerca de 1.300 subclasses, dado público do IBGE): carregar para validar e mostrar a descrição? *Recomendo:* **não** nesta fase; só formato (7 dígitos). Carregar quando a relevância (Fase 04) precisar.
5. **Inscrição estadual** tem formato por UF. *Recomendo:* texto livre com limite; sem validação por UF.
6. **Municípios:** carregar a lista do IBGE (5.570) em `pub.municipios`? *Recomendo:* UF fixa (27) agora; município como texto + código IBGE opcional; carregar a tabela na Fase 04, que é quando os filtros passam a valer.
7. **Módulo de permissão das palavras-chave:** reusar `produtos` ou criar um módulo `palavras_chave`? *Recomendo:* reusar `produtos` (evita migration de módulo e a matriz continua enxuta).
8. **Revelar CPF, conta e PIX:** pela mesma tela com step-up, ou só por exportação auditada? *Recomendo:* tela com step-up e registro em `audit`, sem exportação nesta fase.
9. **Quem vê custo e preço de referência do produto?** A matriz tem a ação `ver_custos_margens`, mas o módulo certo é `precos` (Fase 07) ou `produtos`? *Recomendo:* `produtos/ver_custos_margens` agora (sem criar nada), reavaliar na Fase 07.
10. **Consultar CNPJ na Receita (preencher razão social e CNAE)?** Integração externa = custo e dependência. *Recomendo:* **não** nesta fase.
11. **Representante sem acesso ao sistema:** o representante é só um cadastro (não é usuário)? *Recomendo:* sim, só cadastro; ligar a um usuário é decisão futura.
12. **Extensão `pg_trgm`** (busca por texto em produtos): permitida no `db/init`? *Recomendo:* sim (licença PostgreSQL, já vem no contrib do Postgres 17).
13. **Importação de produtos por planilha:** entra? *Recomendo:* fora do MVP desta fase (cadastro pela tela e por API); avaliar com 20 produtos reais na Fase 06.
14. **Formato da cifra de campo** compatível entre TS e Python (ADR-017): a Fase 02 só usa a API (TS). *Recomendo:* já gravar o formato `{v, dek, iv, ct}` do ADR e escrever os vetores de teste, para o worker (Python) implementar na fase em que precisar decifrar.
16. **Retificar um enquadramento digitado errado** (nasceu da revisão da migration do PR 1): o histórico é só inclusão e uma linha por data, então o porte errado numa data não tem correção. *Recomendo:* permitir que SUPERADMIN marque a linha como retificada (nova coluna e `enquadramento_em` ignorando as retificadas), em migration própria **antes** da Fase 05; até lá a limitação está registrada na migration. Decisão do Adriano.
15. **Prioridade:** começar pelo PR 1 (empresa completa) ou pelo catálogo (PR 6), que destrava a Fase 06? *Recomendo:* a ordem da seção 10 (empresa → representantes → catálogo → produtos), porque empresa e signatário são exigência da Fase 05 (MVP).
