# CLAUDE.md · VV Licitações

As regras do projeto valem para todos os agentes e estão em `AGENTS.md`, importado abaixo. Este arquivo só acrescenta o que é específico do Claude Code.

@AGENTS.md

## Específico do Claude Code

### Como começar uma sessão

1. Leia `docs/roadmap.md` para saber a fase atual e `docs/agents/em-andamento.md` para ver se outro agente está mexendo na mesma área.
2. Se a tarefa for de uma fase, leia a spec dela em `docs/specs/`. Sem spec `Aprovada`, a única tarefa possível é escrever/ajustar a spec.
3. Para trabalho com mais de um passo, use plan mode e mostre o plano antes de editar.

### Comandos do projeto (`.claude/commands/`)

| Comando | Uso |
| --- | --- |
| `/spec 01` | Escreve ou revisa `docs/specs/fase-01.md` a partir do Prompt Mestre e do plano |
| `/migration <descrição>` | Gera migration + RLS + pgTAP de isolamento, seguindo `supabase/AGENTS.md` |
| `/isolamento <schema.tabela>` | Escreve o teste A x B de uma tabela |
| `/adr <título>` | Cria o próximo ADR a partir do modelo |
| `/revisar` | Revisa a branch atual contra o Definition of Done e o modelo de ameaças |
| `/relatorio-fase 01` | Gera `docs/phase-reports/fase-01.md` com evidências reais |
| `/handoff` | Registra o estado da tarefa para outro agente ou sessão continuar |

Os comandos são finos: cada um aponta para um prompt neutro em `docs/agents/prompts/`, que qualquer outro agente também usa.

### Subagentes (`.claude/agents/`)

- `revisor-migration` — revisa SQL, RLS e grants. Use **sempre** antes de pedir revisão humana de uma migration.
- `revisor-seguranca` — revisa um diff contra o modelo de ameaças e o ASVS L2 resumido.
- `auditor-fase` — confere critérios de aceite de uma fase contra evidências reais e aponta lacunas.

### Hooks (`.claude/hooks/guard.py`)

Bloqueiam antes de executar: service role / chave secreta em `apps/web`, edição de `.env` reais, edição de migration já commitada no `main`, `float` em `rules/`, e comandos destrutivos (`git push --force`, `supabase db reset --linked`, `drop database`, `rm -rf /`...). Se um hook bloquear, **não contorne**: explique ao Adriano e peça orientação.

### Supabase MCP

Se o MCP do Supabase estiver conectado, use-o só para **ler** (docs, advisors, logs, listar tabelas). Mudança de schema vai sempre por arquivo de migration no repositório e PR, nunca por `apply_migration`/`execute_sql` direto em projeto remoto.
