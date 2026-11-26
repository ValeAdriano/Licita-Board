# Prompt · 08 Kickoff e execução por item (Claude Code, sessão única)

> Adaptação do `KICKOFF.md` do `claude-setup` ao VV Licitações. No Claude Code: `/kickoff` (reconhecimento) e `/item Q-NN` (um item da fila). Para vários workers em paralelo, use o orquestrador (`/orquestrar`, [`00-orquestrador.md`](00-orquestrador.md)).
>
> **O que muda em relação ao `KICKOFF.md` original:** roadmap e fila já existem (`docs/roadmap.md`, `docs/agents/fila.md`), então nada de `.claude/work/roadmap.md`; o `CLAUDE.md` da raiz não é reescrito (as regras vivem no `AGENTS.md`); tudo direto no `main`, sem branch; o agente `reviewer` só roda quando o Adriano pedir (AGENTS.md §0); o plugin `superpowers` fica desligado, porque impõe worktree, brainstorming e TDD em tudo.

## A. Kickoff (só reconhecimento e planejamento, sem código de produto)

1. **Leia:** `AGENTS.md` (§0, §3, §9), `docs/agents/COMECE-AQUI.md`, `docs/roadmap.md`, `docs/agents/fila.md` e `docs/agents/em-andamento.md`. Não releia o que estes arquivos já resumem.
2. **Graphify:** se `graphify-out/graph.json` não existir, rode a skill `/graphify` na raiz (o grafo fica fora do git). Depois de mudar código, `graphify update .`.
3. **Base de testes:** rode `make test-all` (web, api unit e worker; e2e e pgTAP ficam de fora, precisam da stack). Anote por módulo o que passou, falhou ou não tem teste. Confira se os blocos de `.claude/test-blocks.tsv` cobrem os módulos que importam; acrescente blocos se faltar (ex.: um módulo do worker com teste próprio).
4. **Fila contra a realidade:** compare `fila.md` com o roadmap, as specs (§7/§12) e o `em-andamento.md`. Item já no `main`, tarefa em worktree abandonada (`git worktree list`), item `pronto` que na verdade depende do Adriano: corrija a fila. Itens de tela recebem a nota "ui-designer + design-guide".
5. **Registre** (regra 20), num commit só de docs no `main` (`docs(fila): kickoff ...`): estado dos testes no `COMECE-AQUI.md` §4, fila corrigida, linha no `em-andamento.md`.
6. **No chat, até 20 linhas:** estado dos testes, os 5 próximos itens `pronto` da fila (por prioridade) e as decisões que só o Adriano toma, numeradas (`COMECE-AQUI.md` §6 + o que surgir). **Pare e espere o Adriano.**

## B. Um item da fila (`/item Q-NN`, uma sessão por item, `/clear` entre itens)

1. Leia o item na `fila.md` e a spec da fase. **Sem spec `Aprovada` cobrindo o item, a única tarefa é escrever ou ajustar a spec** ([`01-spec.md`](01-spec.md)) e parar.
2. Item ⚖️ / 🧾 ou com dúvida de regra jurídica/tributária: pergunte antes (AGENTS.md §9). Uma pergunta por vez.
3. Item médio ou grande: use o agente `planner` (Opus) para quebrar em blocos e salve o plano em `.claude/work/<Q-NN>/plan.md` (fora do git; serve para retomar depois de um `/clear`). Item pequeno: vá direto.
4. **Por bloco:** `test-writer` quando o teste acelerar (regras, `rules/`, permissão, SQL complicado; obrigatório em `rules/`) → `implementer` (ou você mesmo, se for pequeno) → `make test-block B=<bloco>` ou `make test-changed` → commit curto no `main` → push ao fechar o item. Tela: `ui-designer` com a skill `design-guide`, e os tokens do Untitled UI (ADR-020) vencem o guia.
5. **Ao fechar:** atualize no mesmo commit spec §7/§12, `fila.md` (status `integrado` + nota), `em-andamento.md`, `COMECE-AQUI.md` e `roadmap.md` se mudou o estado. Recurso pela metade aparece como "EM DESENVOLVIMENTO" na tela e numa frase no fim da resposta.
6. Sessão única não tem orquestrador: aqui você mesmo atualiza a `fila.md`.

## C. Execução contínua (plano já aprovado)

Cole na sessão, trocando o item:

```markdown
Execute o plano de .claude/work/<Q-NN>/plan.md do início ao fim, no main, decidindo sozinho
e registrando cada decisão em "## Decisões" do plan.md. Pare só se: um bloco falhar 2 vezes,
uma decisão mudar comportamento existente, um teste existente quebrar, o caso cair no §9 do
AGENTS.md (prazo legal, tributo, LGPD, migration aplicada, RLS, has_permission, audit,
dependência nova) ou precisar de produção ou credenciais. No fim: make test-all, push e
resumo em até 20 linhas (testado, sem teste, de fora).
```
