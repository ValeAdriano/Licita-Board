# Spec · Fase 09 · Participação nas disputas e resultados (núcleo)

- **Status:** Aprovada em 2026-11-05 (instrução do Adriano: "siga desenvolvendo sem interrupções, uma fase após a outra"). Decisões abaixo são recomendações minhas, registradas para revisão.
- **Onda:** 6
- **Autor:** Claude Code (2026-11-05) · **Aprovação:** Adriano Vale, 2026-11-05
- **Validação:** ⚖️ o prazo da intenção de recurso vem da regra da agenda (Lei 14.133, art. 165, §1º, "imediato"), **ainda não validada pelo jurídico**.
- **Fontes:** Prompt Mestre Fase 09 (9.1 a 9.5); Fase 05 (participações, eventos, `priv.registrar_fato`); regra 17 do AGENTS.md.

> O sistema **só registra**: nunca dá lance nem protocola nada em portal (regra 17). **Arrematação não é homologação**: são resultados diferentes.

## 1. Escopo

**Entra neste bloco:** os 20 status de participação do Prompt (9.1) mais os já existentes; o **resultado por item** (`priv.resultados_item`: valor inicial e final, classificação, melhor lance, vencedora com CNPJ/nome/marca-modelo, motivo da perda, situação de habilitação, resultado final e quando ocorreu); o **gatilho jurídico (9.3)**: perder, ser inabilitada ou desclassificada (ou não ficar em 1º) abre o evento **Intenção de recurso** na agenda, com prazo calculado pelo worker; o **histórico pesquisável (9.4)** por texto, órgão/município, marca/modelo (nossa e da vencedora), ano e resultado; tela de registro (item do acompanhamento) e aba **Resultados** na Agenda.

**Fica para os próximos blocos:** documentos posteriores (9.5: ata, decisões, adjudicação, homologação, contrato, empenhos), análise de viabilidade recursal (Fase 10.4, que consome o gatilho), alerta durante a sessão em tempo real, busca por portal e por valor, registro do comprovante de envio da proposta ao portal.

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

- 2026-11-05 · núcleo pronto: migration `20261113100000` (status ampliados, `priv.resultados_item`, `priv.registrar_resultado`), API `apps/api/src/resultados`, tela (botão "Resultado" em cada item e aba "Resultados" na Agenda). Testes: pgTAP 290 e isolamento A x B, e2e (fluxo, gatilho, histórico, A x B). Conferido na stack real: registrar "perdida" criou o evento "Intenção de recurso" na agenda (selo ⚖️ regra não validada) e o histórico mostrou o resultado.
