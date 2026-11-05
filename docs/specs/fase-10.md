# Spec · Fase 10 · Módulo jurídico (núcleo: base verificada, peças, fluxo e conferência de citações)

- **Status:** Aprovada em 2026-11-05 (instrução do Adriano: "continue para as próximas etapas sem interrupções"). Decisões abaixo são recomendações minhas, registradas para revisão.
- **Onda:** 5/6
- **Autor:** Claude Code (2026-11-05) · **Aprovação:** Adriano Vale, 2026-11-05
- **Validação:** ⚖️ **tudo o que é conteúdo jurídico é do jurídico VV**: a base de leis, acórdãos e súmulas **nasce VAZIA** (eu não cadastro nem cito norma nenhuma); modelos de peça, teses e prazos dependem deles.
- **Fontes:** Prompt Mestre Fase 10 (10.1 a 10.9); Fase 05 (eventos e prazos `esclarecimento`, `impugnacao`, `intencao_recurso`, `razoes_recurso`, `contrarrazoes`); Fase 08 (`docx.py`, PDF, hash); Fase 09 (gatilho de recurso); perfil `JURIDICO`.

> **Princípios (10.1):** a pessoa de perfil jurídico decide, revisa e aprova; **nenhuma citação de lei, acórdão ou súmula pode estar fora da base verificada** e o sistema **bloqueia** as não localizadas; peças são privadas da empresa; o sistema **nunca protocola**: a pessoa autorizada protocola e anexa o comprovante; sem aprovação do perfil jurídico não há documento final.

## 1. Escopo

**Entra neste bloco:**

- **Base jurídica verificada** (`priv.base_juridica`, por empresa): norma/acórdão/súmula com tipo, número, órgão, dispositivo (artigo), ementa, data, **link oficial** e **quem verificou e quando**. Só quem tem permissão de elaborar peça cadastra; só entrada **verificada** serve de fundamento.
- **Conferência de citações** (`rules/citacoes.py`, código puro, 100% de cobertura): extrai do texto da minuta cada citação (Lei/LC/Decreto n/ano, artigo, Acórdão n/ano, Súmula n, Constituição) e confere na base; qualquer não localizada **bloqueia** a minuta.
- **Peças** (`priv.pecas`): esclarecimento, impugnação, recurso e contrarrazões, ligadas ao acompanhamento e, se houver, ao **evento da agenda** (prazo e alertas já existem). Fluxo (10.7): `sugerida → triagem → minuta → revisão → aprovada → final → protocolada → respondida`, com descarte justificado, quem/quando em cada etapa, e **resultado** (deferido, parcialmente deferido, indeferido).
- **Documento final** em Word e PDF (reaproveita `docx.py` e o PDF da Fase 08), com **SHA-256** e **bloqueio**; sem aprovação do perfil jurídico não há final.
- **Protocolo humano:** registra número, data/hora e comprovante; marca o evento da agenda como protocolado.
- **Tela:** lista de peças com prazo, editor da minuta com as citações conferidas, base jurídica.

**Fica para os próximos blocos:**

| Item | Por quê |
| --- | --- |
| Minuta pela IA (10.2 a 10.6) e extração de alegações do recurso de terceiros (10.6) | Usa a chave de IA da empresa; só depois de haver base verificada para o modelo citar. A conferência de citações já protege essa etapa. |
| Análise documental da vencedora e parecer de viabilidade (10.4) | Depende de obter os documentos da concorrente e da matriz da Fase 06 para o produto dela. |
| Sugestões automáticas (10.2, 10.3) | Dependem da IA e do texto do edital; o gatilho de recurso da Fase 09 já cria o evento na agenda. |
| Banco de teses e indicadores (10.8, 10.9) | Dependem de haver peças e resultados. |
| Reautenticação na aprovação (10.7) | Depende de definir o step-up para esta ação. |

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-10.1 | Base jurídica por empresa, com número, órgão, dispositivo, ementa, data, link oficial e verificação (quem/quando) | 10.1 |
| RF-10.2 | Toda citação da minuta é conferida na base; não localizada bloqueia o avanço | 10.1 |
| RF-10.3 | Fluxo da peça com descarte justificado e permissão por etapa; aprovação só de quem tem `juridico/aprovar_peca` | 10.7 |
| RF-10.4 | Documento final com hash, imutável; PDF; nenhuma peça chega ao final sem aprovação | 10.7, 10.1 |
| RF-10.5 | Protocolo é humano: número, data/hora e comprovante registrados; evento da agenda marcado | 10.1, regra 17 |
| RF-10.6 | Isolamento A x B de peças e base; resultado da peça registrado | regra 13 |

## 3. Dados e permissões

- `priv.base_juridica`, `priv.pecas` com `empresa_id`, RLS pelo módulo `juridico` (`visualizar`; criar/editar com `elaborar_peca`; aprovar com `aprovar_peca`; verificar entrada da base com `aprovar_peca`), escrita só por funções, auditoria, versão final imutável por gatilho.

## 4. Critérios de aceite (deste bloco)

| ID | Critério | Prova |
| --- | --- | --- |
| CA-1 | Nenhuma minuta com citação fora da base verificada avança (teste automatizado) | pytest das regras + job com banco + e2e |
| CA-2 | Nenhuma peça chega ao final sem aprovação com `aprovar_peca`; final imutável | pgTAP + e2e |
| CA-3 | Protocolo exige número/data e marca o evento da agenda | pgTAP + e2e |
| CA-4 | Isolamento A x B | pgTAP + e2e |
| CA-5 | Prazos de esclarecimento e impugnação de todo edital na agenda | já na Fase 05 (aguarda validação do jurídico) |

## 5. Estado

- 2026-11-05 · spec aprovada; implementação em blocos (regras puras → banco → worker → API → tela).
- **Núcleo pronto (2026-11-05):** `rules/citacoes.py` (conferência de citações contra a base verificada, 100%), migration `20261117100000` (`priv.base_juridica` e `priv.pecas`, fluxo por funções, final imutável por gatilho — só avançam protocolo, resultado e PDF), job `processar_peca` (`worker/peca.py`: valida, e com a peça aprovada gera .docx e PDF com SHA-256), API `apps/api/src/juridico`, telas `/juridico` (peças e base jurídica) e `/juridico/pecas/:id` (item "Jurídico" no menu). Testes: pytest (citações, job com banco), pgTAP 320 e isolamento A x B (2 tabelas), e2e (fluxo, imutabilidade, protocolo humano que marca o evento da agenda, A x B). **Conferido na stack real:** uma minuta com "Acórdão 999/2022" inventado foi BLOQUEADA, corrigida passou, foi à revisão, aprovada, e o worker gerou o .docx e o PDF com hash.
- **Decisões que tomei (revisáveis):** a base nasce vazia e só entrada verificada vale; a verificação é de quem tem `juridico/aprovar_peca` e o cadastro de quem tem `elaborar_peca`; a minuta exige as cláusulas/páginas do edital (10.1); aprovar não exige outra pessoa que a autora (fica registrado quem elaborou e quem aprovou); a conferência reconhece Lei/LC/Decreto n/ano, artigo, Acórdão n/ano, Súmula n e Constituição, e um artigo só vale se alguma fonte verificada o traz.
- **Falta na Fase 10:** minuta pela IA e leitura de recurso de terceiros (10.2 a 10.6), análise da vencedora e parecer de viabilidade (10.4), sugestões automáticas, banco de teses e indicadores (10.8, 10.9), reautenticação na aprovação. ⚖️ A base de fontes, os modelos de peça e os prazos dependem do jurídico.
