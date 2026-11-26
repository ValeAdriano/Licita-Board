# CLAUDE.md · VV Licitações

As regras do projeto valem para todos os agentes e estão em `AGENTS.md`, importado abaixo. **Modo atual: desenvolvimento rápido, tudo no `main`, sem PR, sem CI, revisores só nas exceções (AGENTS.md §0).** Este arquivo só acrescenta o que é específico do Claude Code.

@AGENTS.md

## Específico do Claude Code

### Como começar uma sessão

0. Leia `docs/agents/COMECE-AQUI.md` (estado real e próximos passos). **Conta pessoal do Adriano = `acsvalefilho@gmail.com`: nunca teste com ela** (AGENTS.md regra 19); use `scripts/criar-usuario-teste.sh`.
1. Leia `docs/roadmap.md` para saber a fase atual e `docs/agents/em-andamento.md` para ver se outro agente está mexendo na mesma área.
2. Se a tarefa for de uma fase, leia a spec dela em `docs/specs/`. Sem spec `Aprovada`, a única tarefa possível é escrever/ajustar a spec.
3. Não use plan mode nem peça aprovação de plano: decida e execute (AGENTS.md §0).

### Comandos do projeto (`.claude/commands/`)

| Comando | Uso |
| --- | --- |
| `/spec 01` | Escreve ou revisa `docs/specs/fase-01.md` a partir do Prompt Mestre e do plano |
| `/migration <descrição>` | Gera migration + RLS + pgTAP de isolamento, seguindo `db/` (regras em `db/AGENTS.md`) |
| `/isolamento <schema.tabela>` | Escreve o teste A x B de uma tabela |
| `/adr <título>` | Cria o próximo ADR a partir do modelo |
| `/revisar` | Revisa a branch atual contra o Definition of Done e o modelo de ameaças |
| `/relatorio-fase 01` | Gera `docs/phase-reports/fase-01.md` com evidências reais |
| `/handoff` | Registra o estado da tarefa para outro agente ou sessão continuar |
| `/kickoff [contexto]` | Reconhecimento da sessão: graphify, `make test-all`, fila conferida, decisões pendentes (sem código) |
| `/item Q-NN` | Executa um item da fila em blocos, direto no `main` (`docs/agents/prompts/08-kickoff.md`) |
| `/orquestrar [contexto]` | Orquestrador do Paseo: consome `docs/agents/fila.md` e delega a workers (`docs/agents/orquestracao.md`) |

Os comandos são finos: cada um aponta para um prompt neutro em `docs/agents/prompts/`, que qualquer outro agente também usa.

### Subagentes (`.claude/agents/`)

- `revisor-migration` — revisa SQL, RLS e grants. Obrigatório nas exceções do AGENTS.md §0; fora delas, só sob pedido.
- `revisor-seguranca` — revisa um diff contra o modelo de ameaças e o ASVS L2 resumido. Obrigatório nas exceções do AGENTS.md §0; fora delas, só sob pedido.
- `auditor-fase` — confere critérios de aceite de uma fase contra evidências reais e aponta lacunas. Só sob pedido.

### Hooks (`.claude/hooks/guard.py`)

Bloqueiam antes de executar: credencial de banco/S3/chave-mestra/service role em `apps/web`, credencial de `vv_worker`/`vv_owner` em `apps/api`, edição de `.env` reais, edição de migration já commitada no `main` (`db/migrations/`), RLS desligado, `float` em `rules/`. Pedem confirmação em comandos destrutivos (`git push --force`, `docker compose down -v`, `docker volume rm`, `dbmate drop`, comandos de produção, `drop database`, `rm -rf /`...). Se um hook bloquear, **não contorne**: explique ao Adriano e peça orientação.

### Testes em blocos e hooks de teste (setup `claude-setup`, 2026-11-26)

- Alvos: `make test-file F=<arquivo>`, `make test-block B=<nome>` (blocos em `.claude/test-blocks.tsv`), `make test-changed`, `make test-all`. O roteador `.claude/bin/test-monorepo.sh` manda cada arquivo para o app certo (web/api: `vitest related`; worker: `pytest` do `test_<módulo>.py`). `db/`, `infra/` e e2e não rodam no automático: use `make test-block B=api-e2e` ou o pgTAP da §6 do AGENTS.md.
- Hooks: ao editar código, roda os testes relacionados (só as falhas voltam); ao encerrar o turno, roda os afetados pelo diff. Desligar o do encerramento: `touch .claude/NO_STOP_TESTS`.
- Trava: sem `.claude/ALLOW_TESTS` (fora do git, só nesta máquina) nenhum teste roda. Worktrees de workers não têm a trava, então lá os hooks não rodam.
- Os agentes globais (`planner`, `test-writer`, `implementer`, `reviewer`, `ui-designer`, `explorer`) e as skills `dev-workflow`/`design-guide` ficam em `~/.claude`. **O modo rápido (AGENTS.md §0) vence o `~/.claude/CLAUDE.md`**: tudo no `main`, sem branch, e o `reviewer` só nas exceções do AGENTS.md §0 ou quando o Adriano pedir.

### Supabase (revisão 1, descontinuado)

O projeto saiu do Supabase (ADR-011). Não use o MCP do Supabase para nada além de leitura, e só se o Adriano pedir. O projeto remoto `gqrilopolbanlrdyrrsd` aguarda decisão (pausar ou excluir).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
