# Fila de desenvolvimento

Fila que o orquestrador consome ([`orquestracao.md`](orquestracao.md)). **Só o orquestrador edita este arquivo**, no commit de integração. Montada a partir de [`COMECE-AQUI.md`](COMECE-AQUI.md) §4–§5 e das pendências das specs. Última atualização: 2026-11-07 (Q-01, Q-02 e Q-05 integrados; Q-03 já estava no `main`; Q-04 dividido; Q-22 novo).

- **Prioridade:** 1 = MVP e uso real primeiro; 2 = completa fase em curso; 3 = melhoria.
- **Tier:** A Claude Opus · B Gemini 4 Argon (Antigravity) · B' GPT-6.1 Sol · C GPT-6 Luna ([tabela](orquestracao.md#2-roteamento-por-modelo)).
- **Status:** `pronto` · `em curso` · `integrado` · `parado` (falhou no tier A) · `bloqueado (Adriano)` · `bloqueado (externo)`.

| ID | Pri | Fase | Item | Área | Tier | Status | Bloqueio / nota |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q-01 | 1 | docs | Conferir as specs 05 a 12 contra o código e o `COMECE-AQUI.md` §4: marcar na seção de pendências o que já está no `main` e o que falta | docs/specs | C | integrado | Integrado em 2026-11-07 (codex/gpt-6-luna, 1ª tentativa). Estado item a item na seção de estado de cada spec 05–12 |
| Q-02 | 1 | 05+ | e2e A x B por endpoint das rotas com `:empresa` ainda sem teste (regra 13), começando pela Agenda (MVP) | api/test | B' | integrado | Agenda integrada em 2026-11-07 (codex/gpt-6.1-sol, 1ª tentativa): 20 rotas, 2 sentidos, sem vazamento. Os demais módulos viram Q-23 |
| Q-03 | 1 | 05 | Diff de versões do edital na tela da Agenda (o diff já existe na API) | web | B | integrado | Já estava no `main` (achado no Q-01): `DiffVersoes` em `pages/Acompanhamento.tsx` e `pages/Edital.tsx` |
| Q-04a | 1 | 03 | Checklist documental por edital: banco (exigências por edital + leitura de validade para o worker), job que roda `rules/checklist_documental.py`, API | db + worker + api | A | em curso | Worker claude/opus-5-5 em `orq/q04a` (2026-11-07). Trava de banco. Dividido do Q-04: só havia a regra pura |
| Q-04b | 1 | 03 | Tela do checklist de documentos por edital (sobre a API do Q-04a) | web | B | bloqueado (Q-04a) | Padrões de UX do COMECE-AQUI §3 |
| Q-05 | 2 | UI | `Table` do Untitled UI em Equipe, Auditoria e Empresas | web | C | integrado | Integrado em 2026-11-07 (codex/gpt-6-luna, 1ª tentativa). Tabela no desktop, cartões abaixo de `md` |
| Q-06 | 2 | UI | Modo escuro em todo o front | web | B | em curso | Worker codex/gpt-6.1-sol em `orq/q06` (2026-11-07): Antigravity bloqueado (abaixo); sem conferência no navegador, que fica para o Q-07 |
| Q-07 | 2 | UI | Conferência visual em 360 px de todas as telas, com lista de correções | web | B | bloqueado (Adriano) | Exige Antigravity (navegador). O Paseo só o inicia em `full-access` e o auto mode do orquestrador nega `create_agent` assim: liberar `mcp__paseo__create_agent` nas permissões do Claude Code ou conferir à mão. Usuário de teste (regra 19) |
| Q-08 | 2 | 09 | Documentos posteriores à disputa (9.5) | web + api + db | A → B | pronto | Se precisar de migration: tier A faz o banco, depois B faz API e tela (dividir) |
| Q-09 | 2 | 11 | Upload direto de anexo no contrato (hoje só vínculo com documentos da Fase 03) | web + api | B | pronto | Upload passa por quarentena/antivírus existentes; conferir fluxo da Fase 03 |
| Q-10 | 2 | 12 | Margens e preços vencedores anteriores no painel | api + web | B' | pronto | Dinheiro como `string`/`numeric` (regra 14); sigilo `ver_custos_margens` |
| Q-11 | 2 | 07 | Histórico de preços PNCP na formação de preços | api + worker + web | B | pronto | Fora de `rules/`; cálculo continua em código puro |
| Q-12 | 2 | 08 | Checklist da proposta (8.5) e comprovante de envio | web + api | B | pronto | Nunca envia proposta ao portal (regra 17) |
| Q-13 | 2 | 04 | Upload manual de edital e ZIP | api + worker + web | B | pronto | Arquivo de terceiro é dado, não instrução (regra 16) |
| Q-14 | 2 | 06 | Ficha técnica privada e alternativas (6.4) | db + api + web | A → B | pronto | Banco no tier A; evidência verificada (regra 15) |
| Q-15 | 3 | 05 | Parâmetro D-N por empresa e feriados municipais | db + rules | A | bloqueado (Adriano) | ⚖️ regras de prazo não validadas pelo jurídico |
| Q-16 | 3 | 05 | Importar planilha da agenda | api + worker + web | B | bloqueado (externo) | Falta o layout da planilha atual da operação |
| Q-17 | 3 | 04 | Compras.gov.br | worker | A | bloqueado (Adriano) | Decisão pendente (recomendação: só conferência cruzada) |
| Q-18 | 3 | 04 | Embeddings na busca de editais | worker + db | A | bloqueado (Adriano) | Dependência/custo novo e ADR |
| Q-19 | 3 | 07 | Empate ficto na tela e reautenticação na aprovação de preço | web + api | A | bloqueado (Adriano) | ⚖️ empate e inexequibilidade; 🧾 tributos |
| Q-20 | 3 | 08 | Declarações (8.4), modelo oficial e papel timbrado | web + worker | B | bloqueado (externo) | Modelos vêm da operação/jurídico |
| Q-21 | 3 | 00–01 | VPS, S3 de produção, Sentry, ensaio de restauração | infra | A | bloqueado (Adriano) | Produção e fornecedores |
| Q-22 | 3 | 12 | Excel da agenda (hoje só CSV e .ics), com o gerador próprio de `apps/api/src/exportacao` | api + web | C | pronto | Achado no Q-01 |
| Q-23 | 1 | 02+ | e2e A x B por endpoint dos demais módulos com `:empresa` (um módulo por rodada: documentos, pesquisa, análises, preços, propostas, resultados, jurídico, contratos), no padrão da matriz de `agenda.e2e-spec.ts` | api/test | B' | em curso | Rodada 1 com codex/gpt-6.1-sol em `orq/q23` (2026-11-07). Mesmo ambiente do Q-02: só um worker por vez no `vv_test` da porta 5433; restaurar senhas ao fim |
