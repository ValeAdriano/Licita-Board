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
- **Exportação CSV** (12.5) dos resultados (com `agenda/exportar`); a agenda exporta CSV, Excel e .ics.

**Definições (auditáveis):** vitória = resultado `adjudicada`, `homologada` ou `contratada` (arrematada não conta: Fase 09); derrota = `perdida`, `inabilitada` ou `desclassificada`; **taxa de sucesso = vitórias ÷ (vitórias + derrotas)** só com resultado registrado; participação = status diferente de avaliando, não vai e cancelada; valor a receber = faturado − retenções informadas − recebido, das notas ainda sem pagamento; entrega pendente = empenho de contrato ativo ainda sem recebimento definitivo ou conclusão; documento vencendo = validade da última versão em até 30 dias; análise pendente = resumo nulo ou PENDENTE; proposta pendente = rascunho, conferência ou aprovada (ainda sem final).

**Fica para os próximos blocos:** margens e preços vencedores anteriores nos relatórios (dependem do histórico de preços do PNCP), relatórios por empresa em visão consolidada de plataforma.

## 2. Critérios de aceite (deste bloco)

| ID | Critério | Prova |
| --- | --- | --- |
| CA-1 | Indicadores correspondem aos registros do banco | e2e com dados conhecidos e soma conferida à parte |
| CA-2 | Usuário vê só o autorizado (`null` sem a permissão) e B não vê nada de A | e2e |
| CA-3 | Exportação correta (BOM, `;`, valores do banco) e restrita a quem exporta | e2e |
| CA-4 | Cálculos auditáveis (definições acima) | esta spec + SQL do endpoint |

## 3. Estado

- ✅ Painel de indicadores com valores nulos conforme permissão e relatório comercial: `apps/api/src/dashboard/dashboard.controller.ts`, `apps/web/src/features/dashboard/Painel.tsx`.
- ✅ Relatório diário por e-mail opt-in e envio após 7h, filtrado por permissões: `apps/worker/src/worker/relatorio_diario.py`, `apps/web/src/features/dashboard/AssinaturaRelatorio.tsx`.
- ✅ Busca avançada entre módulos: `apps/api/src/busca/busca.controller.ts`, `apps/web/src/pages/Busca.tsx`.
- ✅ Exportação Excel e impressão em PDF: `apps/api/src/exportacao/xlsx.ts`, `apps/web/src/features/dashboard/Painel.tsx`.
- 🟡 Margens e preços vencedores anteriores não integram o relatório; o histórico comercial de preços PNCP ainda falta: `apps/api/src/dashboard/dashboard.controller.ts`.
- ✅ Excel de resultados/comercial, indicadores jurídicos e agenda; exportação da agenda reutiliza as linhas do CSV e o gerador próprio: `apps/api/src/exportacao/xlsx.ts`, `apps/api/src/agenda/csv.ts`, `apps/api/src/agenda/agenda.controller.ts`.
- ✅ Q-23 (rodada 5): matriz e2e A x B por endpoint nas 7 rotas de dashboard/relatórios, nos dois sentidos, com empresas próprias por caso; CSV e XML descompactado do Excel sem IDs, marcadores ou valores da outra empresa; assinatura diária e resultados da dona intactos.


- 2026-11-05 · núcleo pronto: API `apps/api/src/dashboard` (`/dashboard`, `/relatorios/comercial`, `/relatorios/resultados.csv`), painel e relatório comercial no Início (`features/dashboard/Painel.tsx`). Testes: e2e (indicadores iguais aos registros, `null` sem permissão, B isolado, relatório comercial com taxa e motivos, CSV). Conferido na stack real: "valores a receber" do painel igual ao do contrato fictício da Fase 11 (R$ 529.626,44).
- **Relatório diário por e-mail (12.2) pronto (2026-11-05):** migrations `20261127100000` e `20261127110000` (`priv.relatorio_diario_assinaturas`; `definir_relatorio_diario`/`minha_assinatura_relatorio` para a PRÓPRIA pessoa; `enfileirar_relatorios_diarios`; funções de contagem `resumo_documentos` e `contratadas_sem_contrato`, porque o worker não lê documentos, resultados nem contratos). **Opt-in** por pessoa e por empresa (interruptor no Início; ninguém recebe sem ligar). O worker enfileira depois das 7h de Brasília (idempotente por pessoa + empresa + dia) e o job `relatorio_diario` (`worker/relatorio_diario.py`) só inclui a seção de um módulo se a pessoa AINDA tem a permissão de visualizar dele: oportunidades (novas, prioritárias), disputas e prazos jurídicos dos **próximos 7 dias corridos** (aproximação dos "5 dias úteis" do Prompt: o cálculo oficial de prazo continua na agenda) e vencidos, editais retificados, peças sugeridas pela IA e em revisão, pendências (propostas, análises, documentos vencidos/vencendo), alertas de contratos e saúde da pesquisa (fontes indisponíveis, falhas de leitura). Sem nada a relatar, não envia. **Nunca leva valor financeiro, custo nem margem.** Isso também entrega o **e-mail dos alertas de contrato** (Fase 11). Testes: pgTAP 420 + isolamento, pytest (composição, seções por permissão, fila idempotente, envio com enviador falso), e2e (opt-in e A x B). **Conferido na stack real:** e-mail chegou ao Mailpit com as seções do usuário de teste. Falta ainda: novos itens e editais alterados por fonte, e-mail em HTML.
- **Pesquisa histórica avançada (12.4) pronta (2026-11-05):** `GET /empresas/:empresa/busca` (`apps/api/src/busca`) e página `/busca` (item "Busca" no menu, permissão `relatorios/visualizar`). Um texto (mín. 2 letras, **ignora acentos**) com filtros combinados (tipos, intervalo de datas, UF do órgão) em **editais** (texto indexado + trecho do objeto, número, processo e órgão), **resultados**, **contratos**, **peças jurídicas** (acha também pela minuta, mas devolve só o título), **documentos** e **produtos**; até 20 por grupo. Cada grupo só é consultado se a pessoa vê o módulo de origem (senão vem `null` e a tela esconde o grupo); a RLS confere de novo. Datas filtram: publicação (editais), validade (documentos), vigência final (contratos), ocorrência (resultados), criação (peças e produtos). Testes: e2e (acento, filtros, módulos permitidos, minuta não vaza, A x B). **Conferido na stack real.** Limite conhecido: a busca por trecho usa `ilike` sem índice (aceitável no volume atual; com milhões de editais, criar índice trigram).
- **Exportação em Excel e PDF (12.5) pronta (2026-11-05):** **Excel**: gerador `.xlsx` próprio, **sem dependência nova** (`apps/api/src/exportacao/xlsx.ts`: pacote ZIP/Open XML com textos em linha, cabeçalho congelado e valores monetários/quantidades gravados como o **texto decimal exato do banco**, sem passar por ponto flutuante; texto nunca vira fórmula). Endpoints: `relatorios/comercial.xlsx` e `relatorios/resultados.xlsx` (permissão `agenda/exportar`, a mesma do CSV) e `juridico/indicadores.xlsx` (`juridico/exportar`). **PDF**: o botão "Salvar em PDF (imprimir)" usa a impressão do navegador com folha de estilo própria (sem menu nem botões), no relatório comercial e nos indicadores do jurídico; não há geração de PDF no servidor para relatórios. Verificação: teste unitário do pacote, e2e (permissão, conteúdo e A x B) e leitura dos arquivos reais pelo openpyxl (leitor independente, uso temporário só para conferir). **NÃO conferido:** abertura no Excel da Microsoft (a imagem do worker só tem o LibreOffice Writer, sem o Calc, então não deu para abrir lá).
- **Q-22 (2026-11-07): Excel da agenda:** `GET /empresas/:e/agenda/eventos.xlsx`, `agenda/exportar`, mesmos filtros e colunas do CSV (montagem compartilhada em `agenda/csv.ts`); botão "Baixar Excel". O gerador não suporta célula com tipo data, então datas ficam como texto em horário de Brasília. Teste unitário da montagem; rota adicionada à cobertura e2e, execução e2e não rodada por banco compartilhado em uso.

- **Q-23 · rodada 12 (2026-11-08):** matriz e2e A x B nos dois sentidos para busca e tarefas: fixtures privadas nas duas empresas, resposta própria sem IDs/textos alheios. Cada caso cria empresas e usuários próprios, compara recurso alheio com UUID inexistente e verifica estado intacto por SHA-256.
