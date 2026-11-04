# Em andamento

Quadro simples de coordenação entre agentes. Atualize ao pegar e ao largar uma tarefa. Uma linha por tarefa ativa.

**Trava de banco:** só uma tarefa por vez com ✅ na coluna "Migrations".

| Branch | Agente | Fase | Área | Migrations | Desde | Status |
| --- | --- | --- | --- | --- | --- | --- |
| main (push direto) | Claude Code | 02 | Fase 02 pronta em banco, API e telas (empresa, contas/PIX cifrados, representantes e procurações, catálogo, produtos, fichas, palavras-chave). Falta: A x B por tabela de priv, docs, retificar enquadramento (spec p.16), poderes do jurídico | — | 2026-11-04 | pausada |
| main (push direto) | Claude Code | 03 | Fase 03 em andamento: S3/ClamAV no Docker, upload em quarentena, download assinado, alertas diários (30/15/10/5/vencido) e pendência "Atualizar" prontos em banco, API, worker e tela. Atestados e checklist (regra pura) prontos; falta tela do checklist (com os editais, Fase 04) e A x B | ✅ | 2026-11-04 | em curso |
| main (push direto) | Claude Code | 04 | Fase 04 em curso: pesquisa PNCP (agendador, coleta, versões, arquivos, texto, relevância, importação, API e telas) rodando no Docker com dados reais. Falta: Compras.gov.br, embeddings, ZIP, upload manual, e2e A x B, amostra de 50 editais | ✅ | 2026-11-04 | em curso |
