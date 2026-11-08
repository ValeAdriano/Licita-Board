# Spec · Fase 11 · Contratos, entregas, faturamento e recebimentos (núcleo)

- **Status:** Aprovada em 2026-11-05 (instrução do Adriano: "continue para as próximas etapas sem interrupções"). Decisões abaixo são recomendações minhas, registradas para revisão.
- **Onda:** 7
- **Autor:** Claude Code (2026-11-05) · **Aprovação:** Adriano Vale, 2026-11-05
- **Validação:** 🧾 retenções tributárias são **valor informado** (nenhuma alíquota é calculada ou suposta); ⚖️ aditivos, reajuste e reequilíbrio ficam como registro e alerta (a análise jurídica entra com a Fase 10).
- **Fontes:** Prompt Mestre Fase 11 (11.1 a 11.5); Fase 09 (resultado "contratada"); regras 13 e 14 do AGENTS.md.

> **Princípios:** dinheiro em `numeric(18,4)`/texto decimal, nunca `float`; **saldos nunca são digitados**: são calculados a partir dos registros (contratado − empenhado − entregue; faturado − recebido); o banco **recusa** empenho acima do saldo do contrato e entrega acima do empenhado; todo registro é por função com permissão, auditado e isolado por empresa.

## 1. Escopo

**Entra neste bloco:** contratos e atas (número, órgão, objeto, valor, vigência, gestor e fiscal do órgão, garantia contratual) e seus **itens com quantidade e preço**; **empenhos e ordens de fornecimento** (vários por contrato) com os itens e as quantidades; **controle de fornecimento** com as 11 etapas do Prompt (cada mudança registra data, responsável e observação) e **entregas parciais** (recebimento provisório ou definitivo); **financeiro** (notas fiscais, valores, retenções informadas, vencimento previsto e pagamento efetivo, valor recebido, ocorrência); **histórico do contrato** (aditivos, apostilamentos, prorrogações, reajustes e ocorrências, com o efeito no valor e na vigência); **resumo e alertas** calculados na hora (contratado, empenhado, entregue, faturado, recebido, a receber, dias de atraso, vigência a vencer, entrega atrasada, pagamento vencido, garantia a vencer).

**Fica para os próximos blocos:** anexos por etapa (Fase 03 já guarda documentos), documentos de regularidade durante a execução, geração de pedido de reajuste/reequilíbrio pelo jurídico, criação automática do contrato a partir do resultado "contratada", notificações e e-mails dos alertas.

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-11.1 | Contrato/ata com órgão, objeto, valor, vigência, gestor, fiscal, garantia e itens | 11.1 |
| RF-11.2 | Vários empenhos/ordens por contrato; saldo do contrato por item atualizado automaticamente; empenho acima do saldo é recusado | 11.2 |
| RF-11.3 | Etapas do fornecimento com histórico; entregas parciais (provisória/definitiva) limitadas ao empenhado | 11.3 |
| RF-11.4 | Notas fiscais, pagamento previsto e efetivo, valor recebido, retenções informadas, ocorrências; valores pendentes e dias de atraso calculados | 11.4 |
| RF-11.5 | Alertas de vigência, entrega, pagamento e garantia calculados; histórico contratual (aditivos etc.) | 11.5 |
| RF-11.6 | Isolamento A x B; permissões `contratos` e `financeiro` | regra 13 |

## 3. Critérios de aceite (deste bloco)

| ID | Critério | Prova |
| --- | --- | --- |
| CA-1 | Saldos contratuais atualizados e empenho/entrega acima do saldo recusados | pgTAP + e2e |
| CA-2 | Entregas e pagamentos parciais registráveis; valores pendentes corretos | pgTAP + e2e |
| CA-3 | Histórico contratual (aditivo altera valor/vigência e fica registrado) | pgTAP + e2e |
| CA-4 | Isolamento A x B e sigilo do financeiro (`financeiro/visualizar`) | pgTAP + e2e |

## 4. Estado

- ✅ Contratos/atas, itens, empenhos, entregas, etapas, faturas, histórico, saldos calculados e alertas: `db/migrations/20261118100000_contratos.sql`, `apps/api/src/contratos/contratos.controller.ts`, `apps/web/src/features/contratos/Lista.tsx`.
- ✅ Notificações internas dos alertas e banner/cadastro pré-preenchido para contratada sem contrato: `db/migrations/20261125100000_contratos_notificacoes.sql`, `apps/web/src/features/contratos/Pendentes.tsx`.
- ✅ Anexos vinculados ao repositório da Fase 03 e pedido de reajuste/reequilíbrio como peça jurídica: `db/migrations/20261126100000_contratos_anexos_pedidos.sql`, `apps/web/src/features/contratos/Anexos.tsx`.
- ✅ E-mail dos alertas está coberto pelo relatório diário opt-in: `apps/worker/src/worker/relatorio_diario.py`.
- ✅ Upload direto na aba de anexos: tipo e arquivo, quarentena e motivo da recusa; vínculo automático somente após liberação, com empenho/etapa escolhidos. Reutiliza o envio da Fase 03, sem alteração de API. A verificação usa espera crescente até 10 s, encerra após 3 minutos com opção de nova tentativa e retoma o vínculo pendente via `sessionStorage` ao reabrir o contrato; pendência pode ser descartada. A chave é isolada por empresa e contrato e guarda apenas IDs e destino: `apps/web/src/features/contratos/EnviarAnexo.tsx`.
- 🟡 Pedido jurídico exige contrato ativo ligado a acompanhamento; contrato sem edital não abre pedido: `db/migrations/20261126100000_contratos_anexos_pedidos.sql`.
- ✅ Q-23 (rodada 5): matriz e2e A x B por endpoint nas 17 rotas de contratos, nos dois sentidos, com fixtures próprias por caso e snapshot dos registros após cada tentativa; documento alheio não é vinculado. Q-31: criação com acompanhamento alheio ou inexistente devolve 404 pela FK composta, preservando o operador sem agenda/visualizar com acompanhamento próprio. Q-31b (migration `20261130100000`): pagamento e encerramento com ID alheio ou inexistente devolvem 404 (`P0002` no banco), com resposta igual à de UUID inexistente e estado intacto; recebido acima do faturado e contrato não ativo seguem em 400; o operador sem financeiro encerra o próprio contrato. Sigilo financeiro (`faturas: null`) e dinheiro como string mantidos na suíte.

- 2026-11-05 · spec aprovada; implementação em blocos (banco → API → tela).
- **Núcleo pronto (2026-11-05):** migration `20261118100000` (contratos, itens, empenhos e itens, etapas, entregas, faturas, histórico; escrita só por função; o banco recusa empenho acima do saldo, entrega acima do empenhado, faturamento acima do saldo do contrato e recebido acima do faturado; valor do contrato = soma dos itens; aditivo atualiza valor e vigência e fica no histórico), API `apps/api/src/contratos` (alertas calculados em `alertas.ts`, puro e testado), telas `/contratos` e `/contratos/:id` (itens e saldos, empenhos e entregas, financeiro, histórico; item "Contratos" no menu). Financeiro com sigilo: sem `financeiro/visualizar` a API devolve `faturas: null` (nunca zeros enganosos). Testes: pgTAP 330 e 8 de isolamento A x B, e2e (saldos, limites, sigilo, histórico, A x B), vitest dos alertas. Conferido na stack real com contrato fictício: 10 × R$ 89.937,74 = R$ 899.377,40; empenho de 6 aceito e de 5 (saldo 4) recusado; a receber R$ 529.626,44 (faturado − retenção informada); alertas de vigência, garantia, entrega atrasada e pagamento vencido.
- **Decisões que tomei (revisáveis):** janelas dos alertas (vigência e garantia 60 dias, entrega 5 dias; pagamento só quando vencido); retenções são valor informado (🧾 nenhuma alíquota é calculada); empenho só em contrato ativo; encerrar ou rescindir é irreversível.
- **Notificações dos alertas e "contratada sem contrato" prontas (2026-11-05):** migration `20261125100000` (`priv.contrato_notificacoes` e `priv.gerar_alertas_contratos(hoje)`, chamada pelo worker uma vez por hora): uma notificação por situação (vigência e garantia 60 dias, entrega 5 dias, pagamento só vencido; idempotente por tipo + referência + marco: "próximo" e "vencido" avisam uma vez cada), para quem tem `contratos/visualizar` (pagamento: `financeiro/visualizar`; "contrato a cadastrar": `contratos/cadastrar`); só contratos ativos, faturas não pagas. As janelas existem em dois lugares (tela: `alertas.ts`; notificações: a função SQL): mudar uma exige mudar a outra. Resultado "contratada" sem contrato ligado ao acompanhamento gera lembrete e aparece como banner em `/contratos` (`GET contratos/pendentes-de-cadastro`, permissão da agenda porque os dados são do acompanhamento) com formulário **pré-preenchido** (órgão, objeto, itens do edital): **o sistema não inventa número, vigência nem valor unitário** (o valor final do resultado é mostrado só como referência, pois não está definido se é unitário ou total). Testes: pgTAP 400 + isolamento, pytest da rodada, e2e. **Conferido na stack real.** **NÃO tem e-mail** (só notificação no app).
- **Anexos e pedidos ao órgão prontos (2026-11-05):** migration `20261126100000`. **Anexos** (`priv.contrato_anexos`; `anexar_documento_contrato`, `remover_anexo_contrato`): vínculo do contrato, ou de uma etapa de um empenho, com um documento que já está no repositório da Fase 03 (quarentena, antivírus, versões, alertas de validade); o arquivo não é copiado, a validade e o status vêm de lá; exige `contratos/editar` e `documentos/visualizar`; sem `documentos/visualizar` o vínculo aparece mas o documento não (sigilo). Cobre também os documentos de regularidade durante a execução (anexo ao contrato inteiro). **Pedido de reajuste/reequilíbrio** (`abrir_pedido_contratual`): abre uma peça jurídica de tipo `reajuste` ou `reequilibrio` (agora válidos em `priv.pecas.tipo`, com `contrato_id`) em triagem, no fluxo normal (minuta, conferência de citações, aprovação, documento final, protocolo humano); exige contrato ativo **ligado a um acompanhamento** (cadastrado a partir do resultado contratado) e `juridico/elaborar_peca`. ⚖️ O sistema não calcula índice de reajuste nem decide direito a reequilíbrio. Tela: aba "Anexos e pedidos" no contrato. Testes: pgTAP 410 + isolamento, e2e (anexos, sigilo, pedidos, A x B), pytest dos rótulos.
- **Falta na Fase 11:** e-mails dos alertas (hoje só notificação no app), upload de arquivo direto na tela do contrato (hoje: cadastrar em Cadastros → Documentos e vincular), contrato sem edital não abre pedido jurídico.
