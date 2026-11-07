# Comece aqui · passagem de bastão entre agentes

Primeiro arquivo para quem assume o desenvolvimento (qualquer agente ou pessoa). **Mantenha-o atualizado a cada bloco de trabalho** (AGENTS.md regra 20): estado real, pendências e próximos passos. Última atualização: 2026-11-06 (orquestração pelo Paseo).

## 1. Regras que mais custam caro quando esquecidas

- **A conta `acsvalefilho@gmail.com` é a conta pessoal do Adriano (usuário real). Nunca entre, altere, redefina nem apague.** Para testar, use o usuário de teste: `scripts/criar-usuario-teste.sh` (cria `agente.teste@exemplo.com.br` com empresa fictícia; a senha fica em `.env.teste`, fora do git; carregue com `set -a && . ./.env.teste && set +a`). Outros perfis: `scripts/criar-usuario.mjs --ficticio` e apague no fim. Nunca apague usuário que você não criou.
- Modo rápido (AGENTS.md §0): tudo direto no `main`, commit curto em português, sem PR/CI/revisores. Nunca `--force`, nunca dado real, nunca segredo no código.
- Perguntar ao Adriano: regra jurídica/tributária, produção, segredos, dado real, migration já aplicada, RLS existente.
- Migration aplicada é imutável: corrigir = nova migration. Só um agente por vez escreve em `db/migrations/`.
- Todo bloco termina com a documentação atualizada no mesmo commit (ver [`documentacao-viva.md`](documentacao-viva.md)): este arquivo, `em-andamento.md`, `docs/roadmap.md`, a spec da fase e o que mais mudou.

## 2. Como subir e verificar

```bash
scripts/dev-up.sh                      # sobe TUDO no Docker, aplica migrations, restaura senhas dos papéis; app em http://localhost:8080, e-mails em http://localhost:8025
scripts/criar-usuario-teste.sh         # uma vez: usuário de teste dos agentes
cd apps/worker && uv run ruff check . && uv run mypy && uv run pytest      # pytest com banco precisa de VV_ADMIN_URL_TEST (superusuário no vv_test)
npm run lint --prefix apps/web && npm run typecheck --prefix apps/web && npm test --prefix apps/web
npm run lint --prefix apps/api && npm run typecheck --prefix apps/api && npm test --prefix apps/api
PGPORT=5433 PGPASSWORD=<POSTGRES_PASSWORD do .env> db/scripts/test-local.sh   # pgTAP (recria o vv_test)
```

2FA: em desenvolvimento é **opcional** (ADR-021, `vv.mfa='opcional'` no banco, ligado pelo `dev-up.sh`); quem cadastrou TOTP ainda precisa do código.

## 3. Armadilhas conhecidas

- `db/scripts/test-local.sh` troca as senhas dos papéis `vv_*` do servidor por aleatórias: depois rode `scripts/dev-up.sh` (restaura as do `.env`) ou o login da API dá 500. Para rodar o e2e logo após, restaure à mão: `alter role vv_api password '<VV_API_PASSWORD do .env>'` (e `vv_owner`, `vv_worker`).
- e2e da API: `DATABASE_URL_TEST` (vv_api no `vv_test`, porta 5433) e `DATABASE_URL_ADMIN_TEST` (postgres); não é idempotente em banco reaproveitado, então recrie o `vv_test` antes (test-local). Comando: `npx vitest run --project e2e <nome>` em `apps/api`.
- Suítes e2e rodam em paralelo no mesmo `vv_test`: na matriz A x B, crie edital/item próprios por caso e compare jobs filtrando pelo `tipo` do módulo (senão uma suíte enxerga os jobs da outra).
- Suítes de e2e (API) e de pytest com banco (worker) compartilham o `vv_test` e se poluem: rode uma, recrie o banco (`db/scripts/test-local.sh`), restaure as senhas e rode a outra (já deu falso negativo em `test_avaliacao`).
- TOTP não aceita o mesmo código duas vezes (anti-replay): em script, espere a janela de 30 s.
- Permissão ausente devolve 404 (não 403) na API. Rota nova com `:empresa` entra no teste `rotas.e2e-spec.ts`.
- `vv_worker` lê `core.usuarios` só por colunas (nunca `senha_hash`): grant de tabela inteira quebra o pgTAP 040 (aconteceu; corrigido pela migration 20261108140000).
- Nova tabela `priv` com `on delete cascade` para `core.empresas` entra na lista do pgTAP `080_exclusao_dupla_aprovacao`.
- Postgres separado para um worker (ex.: porta 5434): a imagem `vv-licitacoes-postgres` só sobe com `VV_OWNER_PASSWORD`, `VV_API_PASSWORD`, `VV_WORKER_PASSWORD` e `VV_DB` definidos (sem eles sai logo depois do initdb).
- pytest com banco usa o CNPJ fixo `11222333000181`: teste que deixa empresa para trás quebra os outros com `empresas_cnpj_key`; gere CNPJ válido próprio (como `test_checklist.py`).
- e2e `auth › força bruta` falha às vezes na suíte inteira (passa sozinho).
- CSP estrita: sem `data:` em imagens, sem `style=` inline; o hash do `<style>` do react-aria está no Caddyfile (ADR-020).
- Coleta PNCP está **desligada** para poupar disco: `update ops.fontes set ativa = true where slug = 'pncp'` religa.

Plano de marcos, MVP e sprints: [`../roadmap-marcos.md`](../roadmap-marcos.md) (próximo sprint: S5 · Endurecimento).

- **Reautenticação nas aprovações (S5)**: `priv.aprovar_peca/aprovar_proposta/aprovar_preco` recebem o token de step-up (`core.exigir_step_up`); a API aceita `stepUp` no corpo e o front usa `useReautenticacao` (tenta sem token; se a API responder 403 abre o modal do TOTP e repete). Em pgTAP use `tests.step_up('usuario_a', '<escopo>')`; em e2e, `lembrarMfa` no `entrar` e `stepUp(app, token, escopo)` de `test/apoio.ts` (o token de sessão muda depois do step-up).
- **Isolamento A x B**: as 48 tabelas `priv` têm teste em `db/tests/isolamento/`; helpers `tests.cena_cadastros()`, `tests.dml_bloqueado()` e `tests.leitura()` (000_helpers). `python3 scripts/check_isolation_coverage.py` passa.

- **Padrões de usabilidade do front (revisão de UX, 2026-11-05)** — mantenha ao criar telas: (1) o **Início é uma central de trabalho**: `GET /empresas/:e/tarefas` (`apps/api/src/tarefas`) lista pendências com **link direto ao item**, só dos módulos que a pessoa vê, e alimenta o "Precisa da sua atenção" e os selos vermelhos do menu (`features/tarefas`); nova pendência = nova consulta nesse controller, não uma tela nova; (2) **estado na URL**: abas e filtros usam `?aba=`/`?q=` (Jurídico, Oportunidades, Busca) para que atalhos, notificações e o botão voltar levem direto ao ponto certo; (3) **busca rápida em todas as telas** (`/` ou Ctrl/Cmd+K, `features/busca/BuscaRapida`); (4) **notificação abre o item com um clique** (marca como lida e navega, trocando de empresa se preciso); (5) **avisos permanentes recolhidos** (`AvisoNota`, uma linha com "Ler tudo"), nunca um bloco longo empurrando o trabalho; (6) formulários de criação recolhidos atrás de um botão e listas com filtro "em andamento" por padrão; (7) indicadores zerados não viram cartões. Veja também `features/tarefas/tarefas.test.tsx`.

## 4. Estado por fase (conferido contra o código em 2026-11-07, Q-01; resumo; o detalhe está em [`../roadmap.md`](../roadmap.md) e nas specs)

| Fase | Estado | Falta |
| --- | --- | --- |
| 00–01 Fundação, acessos | no main | aceite do Adriano, produção (VPS), Sentry |
| 02 Empresas e produtos | no main | A x B de `priv`, decisões do jurídico |
| 03 Documentos e certidões | no main; checklist por edital com banco, job e API (Q-04a: migration `20261128100000`, job `checklist_documental`, `apps/api/src/documentos/checklist.controller.ts`) | tela do checklist (Q-04b), retenção; ⚖️ MEI no aviso ME/EPP |
| 04 Pesquisa PNCP | no main, dados reais no Docker | Compras.gov.br (decisão), embeddings, ZIP, upload manual, amostra de 50 editais |
| 05 Agenda ★ MVP | calendário, prazos, acompanhamento, **alertas D-5/D-3/D-1/dia, escalonamento, prazo perdido automático, .ics, documentos que vencem antes da disputa, diff de versões do edital, reavaliação ao retificar (abertura a reconfirmar)** | importar planilha (exportação CSV pronta; configuração de feriados próprios e D-N pronta; diff de versões já na tela de Acompanhamento e do Edital), feriados municipais oficiais; **regras de prazo NÃO validadas pelo jurídico** |
| UI (ADR-020) | Untitled UI em todo o front | conferir 360 px e contraste do modo escuro em todas as telas (Q-07). Prontos: `Table` em todas as listas (Q-05); modo escuro com seletor Claro/Escuro/Sistema no shell (`src/tema/`, chave `vv.tema`, padrão Sistema, aplicado antes do React; Q-06) |
| 06 Análise técnica | no main: requisitos, matriz por código, citação do edital conferida automaticamente, ficha conferida por pessoa, aprovação, **extração por IA (Anthropic) pronta; a empresa cadastra a própria chave pela interface (Cadastros → IA)** | primeiro uso real da IA (nunca rodou contra a API real), gabarito de 20 editais, texto da ficha privada, alternativas (6.4) |
| 07 Formação de preços | núcleo no main: calculadora por código (Decimal), custos com sigilo (`ver_custos_margens`), alçada, aprovação | histórico PNCP, empate ficto na tela, reautenticação, cenários; 🧾 tributos e ⚖️ empate/inexequibilidade pendentes |
| 08 Propostas | no main: versões, validação 8.6, fluxo, .docx e PDF finais com hash e bloqueio, download | modelo oficial e papel timbrado, declarações (8.4), checklist (8.5), comprovante de envio |
| 09 Disputas e resultados | núcleo no main: resultado por item, status ampliados, gatilho de recurso na agenda, histórico pesquisável | documentos posteriores (9.5), viabilidade recursal (10.4), alerta em tempo real |
| 10 Jurídico | núcleo no main: base jurídica verificada (nasce vazia), peças com fluxo e aprovação, conferência de citações, final .docx/PDF com hash, protocolo humano, resultado | **minuta por IA** (botão "Sugerir minuta com IA" na peça em triagem/minuta; job `minutar_peca`; migration `20261119100000`; **nunca rodou com chave real**, só IA falsa e "desligada" na stack); **recurso de terceiros (10.6)**: aba "Recursos de terceiros" no Jurídico cola o texto, lança o prazo de contrarrazões na agenda, abre a peça e a IA (job `ler_recurso`, migration `20261120100000`) extrai as alegações; o jurídico define rebater/concordar/sem relevância + prova + fundamento; a minuta IA da peça sai ponto a ponto (prompt `min-v2`); alegação a rebater sem prova = ponto de risco (aviso no validador). **parecer de viabilidade recursal (10.4/10.5)**: aba "Viabilidade recursal" lista os itens com gatilho recursal; `/juridico/pareceres/:participacaoId` abre o parecer (texto da concorrente colado), IA opcional sugere achados (job `analisar_vencedora`, `ven-v1`, só com citação literal), o jurídico classifica (forte/moderada/fraca) e registra a recomendação (quem aprova peças); o worker (`validar_parecer`, `rules/parecer.py`) confere só EVIDÊNCIA (forte exige prova e fundamento da base verificada; "recorrer" exige achado forte/moderado com prova); com a evidência ok, "Abrir a peça de recurso" cria a peça (a minuta IA usa os achados fortes/moderados, prompt `min-v3`). Migration `20261121100000`. **sugestões de peças (10.2/10.3)**: aba "Sugestões" no Jurídico; "Buscar sugestões com IA" por edital (job `sugerir_pecas`, `sug-v1`, migration `20261122100000`, 3 buscas/edital/dia) lista esclarecimentos e impugnações com trecho literal do edital, dúvida, impacto, pedido, fundamento SÓ da base verificada e viabilidade (sem fundamento verificado nunca passa de baixa); prazo vencido = intempestiva (não se aceita); aceitar abre a peça em triagem ligada ao prazo da agenda e a minuta IA usa o contexto (prompt `min-v4`); descartar exige justificativa. **teses (10.8) e indicadores (10.9)**: abas "Teses" e "Indicadores" no Jurídico (migration `20261124100000`, job `validar_tese` que bloqueia citação fora da base, aprovação por quem aprova peças, "Inserir no texto" na peça registra o uso, taxa de deferimento = (deferido + parcial) ÷ respondidas; a minuta IA recebe até 5 teses aprovadas do tipo, prompt `min-v5`). Falta busca automática ao indexar o edital (hoje sob pedido, por custo). Falta upload de PDF/link do recurso e dos documentos da concorrente (hoje só texto colado), uso das evidências das Fases 03/06, checklist numérico automático (validade de certidões, índices) que exige dados estruturados da concorrente e parecer (10.4), sugestões automáticas, teses e indicadores; ⚖️ fontes, modelos e prazos do jurídico |
| 11 Contratos | núcleo no main + **notificações dos alertas** (`priv.gerar_alertas_contratos`, rodada horária do worker; janelas duplicadas em `alertas.ts`: mudar nos dois), **banner "contratada sem contrato"** com cadastro pré-preenchido, **anexos** (vínculo com documentos da Fase 03) e **pedido de reajuste/reequilíbrio** como peça do jurídico (migrations `20261125100000` e `20261126100000`); contratos/atas, empenhos, 11 etapas, entregas parciais, financeiro com sigilo, histórico, saldos e alertas calculados | upload direto de anexo pronto (Q-09: `features/contratos/EnviarAnexo.tsx` sobre `src/documentos/upload.ts`; vincula só quando liberado; espera crescente até 3 min; pendência guardada em `sessionStorage` e retomada ao reabrir a aba, com descarte manual, Q-24), falta conferi-lo com arquivo real e antivírus; pedido ao jurídico exige contrato ligado a acompanhamento (contrato sem edital não abre pedido) |
| 12 Dashboard | núcleo no main + **exportação Excel** (gerador próprio em `apps/api/src/exportacao`, sem dependência) e PDF por impressão + **busca avançada entre módulos** (`/busca`, `apps/api/src/busca`) + **relatório diário por e-mail** (opt-in no Início, depois das 7h de Brasília, só seções que a pessoa pode ver; migrations `20261127100000`/`20261127110000`; também cobre o e-mail dos alertas de contrato): painel no Início (13 indicadores, `null` sem permissão), relatório comercial, CSV de resultados | margens e preços vencedores anteriores (aguardam o histórico PNCP, Q-11a); Excel da agenda pronto (Q-22: `GET .../agenda/eventos.xlsx`, datas como texto em Brasília; e2e da rota ainda não rodou); no relatório diário, novos itens/editais alterados por fonte e e-mail em HTML |
| 13 em diante | não iniciadas (sem spec) | — |

## 5. Próximos passos sugeridos (ordem)

**Orquestração (2026-11-06):** a ordem de trabalho agora vive em [`fila.md`](fila.md), consumida por um orquestrador Claude no Paseo (`/orquestrar`; [`orquestracao.md`](orquestracao.md)). Workers (Antigravity/Gemini 4 Argon, Codex GPT-6.1 Sol e GPT-6 Luna) trabalham em worktrees `orq/<id>`; `scripts/conferir-entrega.py` repete o hook de proteção sobre o diff, porque só o Claude Code passa pelo hook. A lista abaixo continua como contexto; ao mudar de prioridade, mude a fila.

1. Fase 05: importar planilha (bloqueado: falta o layout da planilha atual da operação; exportação CSV já existe).
2. Fase 05 e anteriores: A x B (pgTAP e e2e) das tabelas `priv` novas **antes de uso real** (regra 13). Matriz e2e A x B por endpoint (todas as rotas, dois sentidos, recurso intacto) pronta em Agenda (Q-02), Pesquisa, Análises, Preços, Propostas e Resultados (Q-23; em preços, B nunca recebe custo/margem de A); os demais módulos têm A x B parcial (inventário na linha Q-23 da `fila.md`).
3. Fase 04: decidir Compras.gov.br com o Adriano (recomendação: só conferência cruzada).
4. UI: `Table` nas telas restantes, modo escuro, revisão em 360 px.
5. Infra: VPS, S3 de produção, ensaio de restauração do backup (precisa do Adriano).
6. Fase 06: para ligar a IA, a empresa cadastra a chave em Cadastros → IA e usa "Testar a chave" (sem tocar no `.env`); confira o plano do provedor (sem treino com os dados) e acompanhe a primeira extração real (nunca rodou com chave válida). O worker precisa de `VV_KEK` (o `compose.yml` já passa).

- O cruzamento de documentos (RF-05.15) considera todos os documentos da empresa com validade, não só os exigidos pelo edital (falta o checklist por edital).

## 6. Dependências que só o Adriano/jurídico resolvem

Planilha atual da agenda, regras de prazo e 30 casos de teste do jurídico, amostra de 50 editais, decisão Compras.gov.br, destino do projeto Supabase antigo, provedores (VPS/S3 de backup). Lista viva em `docs/roadmap.md` ("Dependências externas abertas").
