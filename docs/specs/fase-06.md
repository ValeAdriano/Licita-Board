# Spec · Fase 06 · Análise técnica (matriz de requisitos, comparação por código e evidência verificável)

- **Status:** Aprovada em 2026-11-05 (instrução do Adriano: "siga desenvolvendo sem interrupções, uma fase após a outra"). Decisões abaixo são recomendações minhas, registradas para revisão.
- **Onda:** 4
- **Autor:** Claude Code (2026-11-05) · **Aprovação:** Adriano Vale, 2026-11-05
- **Validação:** conjunto de teste com editais reais e gabarito humano (20 editais de veículos, Operação VV) **pendente e bloqueante para o aceite**; sem ele as metas de qualidade (≥ 98% dos requisitos, zero "ATENDE" indevido) **não estão medidas**.
- **Fontes:** Prompt Mestre Fase 06 (6.1 a 6.9) e regras 15 e 16 do AGENTS.md; Fase 02 (`priv.produtos`, `priv.produto_atributos`, `pub.atributos_def`, `pub.unidades`); Fase 04 (`pub.trechos`, texto e página do edital); Fase 05 (`priv.participacoes`).

> **Princípio central (regra 15):** a IA **nunca tem a palavra final**. Toda comparação numérica e toda classificação é feita por código puro (`apps/worker/src/worker/rules/`), com unidades normalizadas. A IA, quando ligada, só **propõe requisitos** (com citação literal do edital); o sistema confere se a citação existe no texto do edital e rebaixa o que não existir.

## 1. Escopo

**Entra neste bloco (núcleo que funciona sem IA):**

- **Requisitos por item** (`priv.requisitos_item`): o que o edital exige para a participação (um item), com tipo, operador (≥, ≤, =, faixa, texto, sim/não), valor e unidade, obrigatório ou não, **citação literal do edital** e página. Origem `manual` (cadastro na tela) ou `ia` (proposta pela IA, só depois de ligada).
- **Matriz de análise** (`priv.analise_linhas`): uma linha por (requisito, produto): valor oferecido, **resultado** (`ATENDE`, `ATENDE COM RESSALVAS`, `A CONFIRMAR`, `NÃO ATENDE`), evidência do edital (verificada automaticamente), evidência da ficha técnica (citação, documento, página, **conferida por uma pessoa**), justificativa e pendência.
- **`rules/comparacao.py`** (código puro, 100% de cobertura): conversão de unidades pelas tabelas `pub.unidades` (fator e deslocamento, em `Decimal`), comparação por operador, classificação, resumo do item.
- **`rules/evidencia.py`** (puro): confere se a citação existe no texto do edital (sem acento, caixa ou quebra de linha; hifenização de fim de linha). Citação que não existe → evidência **não verificada** → o requisito vira `A CONFIRMAR`.
- **Job `analisar_item`** (worker): lê requisitos, atributos do produto (já tipados e com unidade) e o texto do edital, aplica as regras e grava a matriz. Idempotente; reexecutado quando o produto ou os requisitos mudam.
- **Aprovação humana** (6.9): a pessoa confere a evidência da ficha técnica linha a linha e aprova a análise do item; fica registrado quem e quando. Aprovar não é editar a classificação: a classificação é sempre do código.
- **Tela:** análise do item (requisitos, produto ofertado, matriz com cores, pendências, resumo "compatível / com ressalvas / pendente / reprovado").

**Fica para os próximos blocos da Fase 06 (não implementado):**

| Item | Por quê |
| --- | --- |
| Extração automática de requisitos pela IA (6.1) e sinalização jurídica (6.5) | Exige provedor de IA (custo mensal e envio de dados): decisão do Adriano. O código fica atrás de uma interface (`llm/`) e **desligado por padrão** (sem chave, o job responde "IA não configurada"). |
| Leitura automática do texto da ficha técnica (verificar a citação do lado do produto) | Hoje o texto extraído é só dos editais públicos; a ficha é documento privado. Enquanto isso, **ATENDE exige a conferência da pessoa** na evidência da ficha. |
| Produtos alternativos e de mercado (6.4) | Depende da busca de mercado (Fase 07 / custo). |
| Conjunto de teste com gabarito e metas (6.7) | Depende dos 20 editais com gabarito (Operação VV). |
| Reanálise automática quando o edital é retificado | Já existe o aviso de retificação (Fase 05); a reanálise automática entra junto da IA. |

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-06.1 | Cadastrar requisitos por item com tipo, operador, valor, unidade, obrigatoriedade, citação e página | 6.1 |
| RF-06.2 | Matriz por requisito e produto com as quatro classificações, evidência, justificativa e pendência | 6.2 |
| RF-06.3 | ATENDE exige: comparação numérica por código satisfeita, citação do edital **conferida automaticamente**, valor do produto cadastrado com unidade e evidência da ficha conferida por pessoa. Sem isso, `A CONFIRMAR` | 6.3 |
| RF-06.4 | Comparação numérica só em código, com unidades normalizadas; grandezas diferentes não se comparam (`A CONFIRMAR`) | 6.3, regra 15 |
| RF-06.5 | Requisito obrigatório não atendido: o item **nunca** recebe classificação de atendimento integral | 6.9 |
| RF-06.6 | Aprovação técnica registrada (quem, quando) por item; mudar requisito ou produto invalida a aprovação | 6.9 |
| RF-06.7 | Texto de edital é dado, nunca instrução; nada envia mensagem, muda status ou apaga registro | 6.6, regra 16 |
| RF-06.8 | Custo, margem e dado pessoal nunca vão ao provedor de IA | 6.8 |

## 3. Classificação (regra pura, `rules/comparacao.py`)

Para cada (requisito, produto), em ordem:

1. **Comparar.** Valor numérico: converte requisito e oferta para a unidade base da grandeza e aplica o operador. Texto: igualdade/contém sem acento nem caixa. Sim/não: igualdade. Faltou valor, unidade ou grandeza incompatível: resultado da comparação **indeterminado**.
2. Comparação **não satisfeita** → `NÃO ATENDE` (o sistema nunca "perdoa" por falta de evidência: a direção conservadora).
3. Comparação **indeterminada** → `A CONFIRMAR` + pendência dizendo o que falta.
4. Comparação **satisfeita**: se a citação do edital **não** foi verificada → `A CONFIRMAR` ("citação não encontrada no edital"); se a evidência da ficha **não** foi conferida por uma pessoa → `A CONFIRMAR` ("falta conferir a ficha técnica"); se há ressalva registrada → `ATENDE COM RESSALVAS`; senão `ATENDE`.
5. **Requisito opcional** que não atende não reprova o item (entra como pendência/observação).

**Resumo do item:** qualquer obrigatório `NÃO ATENDE` → `REPROVADO`; algum obrigatório `A CONFIRMAR` → `PENDENTE`; todos os obrigatórios `ATENDE` ou `ATENDE COM RESSALVAS` → `COMPATÍVEL` (ou `COMPATÍVEL COM RESSALVAS` se houver alguma); sem requisitos obrigatórios cadastrados → `PENDENTE` ("sem requisitos").

## 4. Dados e permissões

- `priv.requisitos_item` e `priv.analise_linhas` (e a aprovação por item em `priv.analises_item`) com `empresa_id`, RLS pelo módulo `analises` (`visualizar`; escrever exige `editar`; aprovar exige `aprovar`), gravação por funções, auditoria e teste de isolamento A x B.
- Valores numéricos em `numeric(30,12)` e `Decimal`; nunca `float`.
- Evidência do edital só lê `pub.trechos` do edital do próprio acompanhamento.

## 5. Critérios de aceite (deste bloco)

| ID | Critério | Prova |
| --- | --- | --- |
| CA-1 | Comparações com conversão (cv→kW, GB→MB, kgf·m→N·m, meses/anos) corretas e grandeza incompatível vira `A CONFIRMAR` | pytest de `rules/comparacao.py` (100%) |
| CA-2 | Nenhum `ATENDE` sem citação verificada **e** ficha conferida | pytest + pgTAP |
| CA-3 | Obrigatório não atendido → item `REPROVADO` | pytest |
| CA-4 | Citação inexistente no edital rebaixa para `A CONFIRMAR` | pytest de `rules/evidencia.py` e do job com banco |
| CA-5 | Isolamento A x B de requisitos, matriz e aprovação | pgTAP + e2e |
| CA-6 | Metas de qualidade com gabarito humano (≥ 98% / zero ATENDE indevido) | **pendente** (20 editais com gabarito) |

## 6. Perguntas abertas (recomendação minha entre parênteses)

1. Ligar a IA para extrair requisitos? Qual provedor/plano (sem treino com os dados)? (Claude via API, plano com retenção zero; só texto do edital, nunca custo/margem/dados pessoais.)
2. Quem aprova a análise técnica de um item? (quem tem `analises/aprovar`; ADMIN_EMPRESA por padrão.)
3. A ficha técnica privada deve ter o texto extraído para conferir a citação automaticamente? (sim, num próximo bloco, reutilizando a extração com OCR.)

## 7. Estado

- 2026-11-07 · spec aprovada; implementação em blocos. Ver [`docs/agents/COMECE-AQUI.md`](../agents/COMECE-AQUI.md).
- ✅ Requisitos por item, matriz, comparação pura, evidência conferida, aprovação humana, worker, API e tela: `apps/worker/src/worker/rules/comparacao.py`, `apps/worker/src/worker/rules/evidencia.py`, `apps/api/src/analises/analises.controller.ts`, `apps/web/src/features/analise/Matriz.tsx`.
- ✅ Extração IA sob pedido, chave por empresa e controle de citação: `apps/worker/src/worker/extracao.py`, `apps/worker/src/worker/llm/extracao_requisitos.py`, `apps/api/src/ia`, `apps/web/src/features/analise/Requisitos.tsx` (integração com provedor real ainda não conferida).
- 🟡 Reanálise por retificação: existe aviso e recálculo da agenda, mas não reexecuta a análise técnica automaticamente: `apps/worker/src/worker/agenda_retificacao.py`.
- ❌ Sinalização jurídica (6.5), conferência automática do texto da ficha privada, produtos alternativos (6.4) e gabarito de 20 editais/metas (6.7); não localizei implementação em `apps/worker/src/worker` nem tela correspondente em `apps/web/src/features/analise`.
- ❌ Cobertura de isolamento A x B de endpoints/tabelas antes de uso real, conforme regra 13: a evidência histórica cita testes, mas não há verificação desta conferência.
- **Núcleo sem IA pronto (2026-11-05):** `rules/comparacao.py` e `rules/evidencia.py` (puros, 100% de cobertura); migration `20261110100000` (`priv.requisitos_item`, `priv.analises_item`, `priv.analise_linhas`, escrita só por função, auditoria); job `analisar_item` no worker (`worker/analise.py`); API em `apps/api/src/analises`; tela `/agenda/participacoes/:id/analise` (link "Análise técnica" em cada item com participação). Testes: pytest (regras + 7 do job com banco), pgTAP 260 e 3 de isolamento A x B, e2e A x B, componente da matriz. Conferido no navegador com o worker real: potência cumpre mas citação inexistente → A CONFIRMAR; garantia menor → NÃO ATENDE; item REPROVADO.
- **Decisões que tomei (revisáveis):** o perfil de análise precisa de `agenda/visualizar` (a participação vive na agenda); aprovar uma análise `REPROVADO` é permitido (registra a rejeição); só `PENDENTE` não se aprova; requisito sem atributo do catálogo vira `A CONFIRMAR` com a pendência "vincule ao atributo"; garantia e prazo de entrega comparam com o cadastro do produto (`garantia_meses`, `prazo_entrega_dias`).
- **IA de extração de requisitos (decisão do Adriano, 2026-11-05, pronta e DESLIGADA até haver chave):** provedor **Anthropic** (Messages API, modelo `claude-sonnet-5-5`, configurável em `VV_LLM_MODELO`), chamado **só pelo worker** (`worker/llm/extracao_requisitos.py`, `worker/extracao.py`; HTTP pela biblioteca padrão, sem dependência nova). **A chave é cadastrada pela interface, por empresa** (Cadastros → IA; quem tem `configuracoes/editar`): cifrada na API com envelope AES-256-GCM (ADR-017, contexto `priv.empresa_ia.chave|empresa`) antes de chegar ao banco, nunca devolvida (só os 4 últimos caracteres; o `vv_api` nem lê a coluna cifrada), decifrada só pelo worker ao chamar o provedor (precisa de `VV_KEK` no worker), com botão de teste (job do worker, 1 token) e escolha de modelo. Cada empresa usa a sua chave e paga o seu uso. `ANTHROPIC_API_KEY` no `.env` ficou só como reserva global opcional. Sem nenhuma chave a extração termina como `desligada`. Migration `20261116100000`; pgTAP 310 e isolamento; pytest (decifrar com os vetores compartilhados, KEK trocada/contexto de outra empresa, teste da chave); e2e (nada do texto aberto no banco nem nas respostas, A x B). Conferido na stack real com uma chave FALSA: o worker decifrou, chegou ao provedor e o teste voltou "o provedor respondeu 401"; a chave não apareceu em nenhum log. Segurança: o texto do edital vai entre `<edital>…</edital>` e o sistema diz ao modelo que é DADO e que ordens dentro dele devem ser ignoradas; o modelo não tem ferramentas; a saída é validada por Pydantic (item fora do esquema é descartado, nunca "consertado"); **cada citação é conferida no texto do edital pelo código** (citação inexistente: o requisito fica SEM citação e nunca vira ATENDE); o requisito nasce `origem = 'ia'` e **não confirmado** (a matriz o trata como "A CONFIRMAR" até uma pessoa confirmar ou remover). Nada da empresa, custo, margem ou dado pessoal vai ao provedor (testado). Cada execução registra modelo, versão do prompt (`req-v1`) e tokens (`priv.extracoes_ia`); limite de 5 pedidos por item por dia (custo). Migration `20261115100000`; pgTAP 300 e isolamento; pytest (cliente HTTP com stub, prompt/injeção, parser, job com banco e IA falsa); e2e. Tela: "Sugerir requisitos com IA" e botão "Confirmar" nas sugestões. **Não testado contra a API real do provedor** (sem chave neste ambiente): o cliente foi testado só com respostas simuladas; o primeiro uso real deve ser acompanhado.
- **Falta na Fase 06:** gabarito de 20 editais para medir as metas (6.7) e ajustar o prompt, sinalização jurídica (6.5), texto da ficha técnica privada para conferir a citação automaticamente, produtos alternativos (6.4), conjunto de teste com gabarito (6.7) e reanálise automática na retificação do edital.
