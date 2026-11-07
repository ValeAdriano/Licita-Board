# Spec · Fase 07 · Formação de preços e viabilidade comercial

- **Status:** Aprovada em 2026-11-05 (instrução do Adriano: "siga desenvolvendo sem interrupções, uma fase após a outra"). Decisões abaixo são recomendações minhas, registradas para revisão.
- **Onda:** 5
- **Autor:** Claude Code (2026-11-05) · **Aprovação:** Adriano Vale, 2026-11-05
- **Validação:** **🧾 parâmetros tributários pendentes e bloqueantes para o uso real** (precisam do responsável contábil); **⚖️ regras de ME/EPP e de inexequibilidade pendentes do jurídico** (nada é suposto: tudo é parâmetro).
- **Fontes:** Prompt Mestre Fase 07 (7.1 a 7.6) e regras 14 e 15 do AGENTS.md; Fase 02 (`priv.produtos`); Fase 05 (`priv.participacoes`).

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
| Histórico comercial de preços vencedores (7.5) | Exige coletar resultados/homologações do PNCP (fonte pública) e busca por produto/marca/órgão. |
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
