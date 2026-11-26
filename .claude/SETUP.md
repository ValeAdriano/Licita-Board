# Setup do Claude Code (VV Licitações)

## O que está instalado
| Peça | Onde | Escopo |
| --- | --- | --- |
| Agentes `planner`, `test-writer`, `implementer`, `reviewer`, `ui-designer`, `explorer` | `~/.claude/agents/` | global (valem em todo projeto) |
| Agentes do projeto `revisor-migration`, `revisor-seguranca`, `auditor-fase` | `.claude/agents/` | projeto (só sob pedido, AGENTS.md §0) |
| Skills `dev-workflow`, `design-guide` | `~/.claude/skills/` | global |
| Comandos `/spec`, `/migration`, `/item`, `/kickoff`... | `.claude/commands/` | projeto |
| Testes em blocos | `.claude/bin/test.sh`, `test-monorepo.sh`, `test-blocks.tsv`, `test.mk` (incluído no `Makefile`) | projeto |
| Hooks | `.claude/hooks/` (`guard.py`, `post-edit.sh`, `stop.sh`), ligados em `.claude/settings.json` | projeto |
| Plugins context7, security-guidance, commit-commands, hookify, frontend-design, ponytail, pyright-lsp | `claude plugin list` | usuário (já instalados; não duplicados no projeto) |
| Plugins code-review, pr-review-toolkit, playwright, superpowers | idem | instalados e **desabilitados** |

## Ligar e desligar
- Testes automáticos: `touch .claude/ALLOW_TESTS` liga (arquivo fora do git, só nesta máquina); `rm` desliga tudo.
- Só o hook de encerramento: `touch .claude/NO_STOP_TESTS` desliga; `rm` religa.
- Plugin sob demanda: `claude plugin enable <nome>@claude-plugins-official` / `disable`.
- Graphify: `graphify claude install` (comando existe em `~/.local/bin/graphify`); depois `graphify update .` após mexer em código. Ainda não há `graphify-out/`.

## Dia a dia
- `make test-file F=<arquivo>` · `make test-block B=<bloco>` (blocos em `.claude/test-blocks.tsv`) · `make test-changed` · `make test-all` (só no fechamento).
- `--quiet` em `.claude/bin/test.sh`: silêncio no sucesso, até 30 linhas na falha.
- Tarefa grande: skill `dev-workflow` (estado em `.claude/work/<tarefa>/`, `/clear` entre fases).
- Modo rápido (AGENTS.md §0): tudo no `main`, sem branch; `reviewer` só quando o Adriano pedir.

## Pré-requisito conhecido
`apps/api` precisa de `npm ci --prefix apps/api` antes de qualquer teste da API (falta `node_modules`: `unplugin-swc` não resolve).
