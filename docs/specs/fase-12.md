# Spec · Fase 12 · Dashboard, relatórios e inteligência comercial (núcleo)

- **Status:** Aprovada em 2026-11-05 (instrução do Adriano: "continue para as próximas etapas sem interrupções"). Decisões abaixo são recomendações minhas, registradas para revisão.
- **Onda:** 7
- **Autor:** Claude Code (2026-11-05) · **Aprovação:** Adriano Vale, 2026-11-05
- **Fontes:** Prompt Mestre Fase 12 (12.1 a 12.5); dados das Fases 03 a 11.

> **Princípios:** todo número vem de contagem ou soma direta dos registros (nada estimado); o indicador só é calculado para quem tem a permissão do módulo de origem (senão vem `null` e a tela esconde o cartão: nunca um zero enganoso); dinheiro como texto decimal; cálculos auditáveis (a regra de cada indicador está nesta spec e no SQL do endpoint).

## 1. Escopo

**Entra neste bloco:**

- **Painel no Início** (12.1): novas oportunidades, disputas futuras, propostas pendentes, análises técnicas pendentes, prazos jurídicos abertos e vencidos, certidões vencendo (30 dias), documentos vencidos, licitações ganhas, valor ganho, contratos ativos, entregas pendentes, valores a receber e saúde das fontes de pesquisa (banner existente).
- **Relatório comercial** (12.3): participações, vitórias, derrotas e motivos, taxa de sucesso, valor disputado e ganho, produtos mais ofertados, órgãos onde mais ganhamos.
- **Exportação CSV** (12.5) dos resultados (com `agenda/exportar`); a agenda já exporta CSV e .ics.

**Definições (auditáveis):** vitória = resultado `adjudicada`, `homologada` ou `contratada` (arrematada não conta: Fase 09); derrota = `perdida`, `inabilitada` ou `desclassificada`; **taxa de sucesso = vitórias ÷ (vitórias + derrotas)** só com resultado registrado; participação = status diferente de avaliando, não vai e cancelada; valor a receber = faturado − retenções informadas − recebido, das notas ainda sem pagamento; entrega pendente = empenho de contrato ativo ainda sem recebimento definitivo ou conclusão; documento vencendo = validade da última versão em até 30 dias; análise pendente = resumo nulo ou PENDENTE; proposta pendente = rascunho, conferência ou aprovada (ainda sem final).

**Fica para os próximos blocos:** relatório diário por e-mail após a varredura (12.2), margens e preços vencedores anteriores nos relatórios (dependem do histórico de preços do PNCP), pesquisa histórica avançada entre módulos (12.4: hoje cada módulo tem a sua busca), exportação em Excel e PDF dos relatórios, relatórios por empresa em visão consolidada de plataforma.

## 2. Critérios de aceite (deste bloco)

| ID | Critério | Prova |
| --- | --- | --- |
| CA-1 | Indicadores correspondem aos registros do banco | e2e com dados conhecidos e soma conferida à parte |
| CA-2 | Usuário vê só o autorizado (`null` sem a permissão) e B não vê nada de A | e2e |
| CA-3 | Exportação correta (BOM, `;`, valores do banco) e restrita a quem exporta | e2e |
| CA-4 | Cálculos auditáveis (definições acima) | esta spec + SQL do endpoint |

## 3. Estado

- 2026-11-05 · núcleo pronto: API `apps/api/src/dashboard` (`/dashboard`, `/relatorios/comercial`, `/relatorios/resultados.csv`), painel e relatório comercial no Início (`features/dashboard/Painel.tsx`). Testes: e2e (indicadores iguais aos registros, `null` sem permissão, B isolado, relatório comercial com taxa e motivos, CSV). Conferido na stack real: "valores a receber" do painel igual ao do contrato fictício da Fase 11 (R$ 529.626,44).
