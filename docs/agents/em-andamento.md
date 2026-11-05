# Em andamento

Quadro simples de coordenação entre agentes. Atualize ao pegar e ao largar uma tarefa. Uma linha por tarefa ativa.

**Trava de banco:** só uma tarefa por vez com ✅ na coluna "Migrations".

| Branch | Agente | Fase | Área | Migrations | Desde | Status |
| --- | --- | --- | --- | --- | --- | --- |
| main (push direto) | Claude Code | 02 | Fase 02 pronta em banco, API e telas (empresa, contas/PIX cifrados, representantes e procurações, catálogo, produtos, fichas, palavras-chave). Falta: A x B por tabela de priv, docs, retificar enquadramento (spec p.16), poderes do jurídico | — | 2026-11-04 | pausada |
| main (push direto) | Claude Code | 03 | Fase 03 em andamento: S3/ClamAV no Docker, upload em quarentena, download assinado, alertas diários (30/15/10/5/vencido) e pendência "Atualizar" prontos em banco, API, worker e tela. Atestados e checklist (regra pura) prontos; falta tela do checklist (com os editais, Fase 04) e A x B | ✅ | 2026-11-04 | em curso |
| main (push direto) | Claude Code | 04 | Fase 04 em curso: pesquisa PNCP (agendador, coleta, versões, arquivos, texto, relevância, importação, API e telas) rodando no Docker com dados reais. Falta: Compras.gov.br, embeddings, ZIP, upload manual, e2e A x B, amostra de 50 editais | ✅ | 2026-11-04 | em curso |
| main (push direto) | Claude Code | UI | Migração de TODO o front para Untitled UI (ADR-020): shell com menu lateral, componentes de `src/ui` sobre `src/components`, abas, campos, modais e selos. Falta: `Table` do Untitled UI em Equipe/Auditoria/Empresas, modo escuro, conferência visual em 360 px de todas as telas | — | 2026-11-04 | em curso |
| main (push direto) | Claude Code | 05 | Fase 05 em curso: agenda (calendário, prazos, acompanhamento) funcionando de ponta a ponta. Alertas e prazo perdido prontos. Falta: importação/exportação Excel, A x B de `priv` novos no CI | ✅ | 2026-11-05 | em curso |
| main (push direto) | Claude Code | 01 | 2FA opcional em dev (ADR-021, `vv.mfa`), usuário de teste dos agentes (`scripts/criar-usuario-teste.sh`), regras 19/20 e `COMECE-AQUI.md` | ✅ | 2026-11-05 | pronto |
