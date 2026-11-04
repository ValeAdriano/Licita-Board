> **Modo rápido (AGENTS.md §0, 2026-11-04):** tudo direto no `main`, sem PR, sem CI do GitHub, sem subagentes revisores; teste só o que acelera. Os guias abaixo valem quando o projeto sair do protótipo.

# Desenvolvimento com agentes de IA

Como o VV Licitações é construído por uma pessoa + agentes. As regras ficam em [`AGENTS.md`](../../AGENTS.md); aqui está o **como**.

## Peças do sistema

| Peça | Onde | Para quê |
| --- | --- | --- |
| Regras globais | `AGENTS.md` (raiz) | Lido automaticamente por Antigravity, Codex, Cursor, Copilot, Paseo; importado pelo `CLAUDE.md` |
| Regras locais | `apps/web/AGENTS.md`, `apps/worker/AGENTS.md`, `db/AGENTS.md` | Detalhes de cada pacote; o agente lê ao trabalhar na pasta |
| Documentação viva | [`documentacao-viva.md`](documentacao-viva.md) | O que atualizar em cada entrega; checklist de fim de tarefa |
| Fluxo por fase | [`fluxo.md`](fluxo.md) | Passo a passo spec → banco → backend → front → testes → relatório |
| Prompts neutros | [`prompts/`](prompts/) | Texto pronto para colar em qualquer agente, um por passo |
| Checklists | [`checklists/`](checklists/) | DoD, revisão de migration, ASVS L2 resumido |
| Glossário | [`glossario.md`](glossario.md) | Vocabulário de licitações que o agente precisa entender |
| Coordenação | [`em-andamento.md`](em-andamento.md), [`handoff.md`](handoff.md) | Quem está mexendo em quê; como passar o bastão |
| Claude Code | `.claude/` | Comandos (`/spec`, `/migration`...), subagentes revisores, hook de proteção |
| Antigravity | `.agents/rules/vv-desenvolvimento.md` | Regra sempre ativa: rotina de início, método, documentação obrigatória, fim de tarefa |
| Rede de segurança | `.github/workflows/ci.yml`, `.semgrep/`, `scripts/` | O que a revisão humana pode deixar passar, o CI pega |

## Qual agente para quê (sugestão)

| Tarefa | Agente sugerido | Por quê |
| --- | --- | --- |
| Spec, ADR, modelo de ameaças | Claude Code (plan mode) | Raciocínio longo sobre requisitos; você revisa |
| Migration + RLS + pgTAP | Claude Code + subagente `revisor-migration` | Parte crítica; revisão automática antes da humana |
| `rules/` (prazos, preços, unidades) | Qualquer um, **testes primeiro** | Casos de teste vêm do jurídico/contador, não do agente |
| Telas a partir de spec pronta | Antigravity / Codex / Paseo em paralelo (worktree) | Trabalho volumoso e bem delimitado; o Antigravity confere a tela no próprio navegador |
| Conector de fonte (PNCP...) | Qualquer um, com fixture gravada | Isolado, fácil de testar |
| Revisão cruzada dos commits | Agente diferente do autor, com `prompts/revisao-pr.md` | Segundo olhar barato |

## Como usar um agente que não é o Claude Code

1. Abra o agente na raiz do repositório (ele lê `AGENTS.md` sozinho; se não ler, cole o conteúdo). O Antigravity também carrega `.agents/rules/` sozinho.
2. Cole o prompt do passo em `docs/agents/prompts/`, trocando os `<placeholders>`.
3. Peça para ele trabalhar direto no `main` (ou numa worktree, se houver outro agente em paralelo), atualizar a documentação na mesma entrega ([`documentacao-viva.md`](documentacao-viva.md)), dar push só com checks verdes e terminar com handoff.
4. Rode a revisão (`prompts/revisao-pr.md`) com outro agente ou com o Claude Code `/revisar`.

## Gates humanos (não delegáveis)

- Aprovar spec (status `Aprovada`).
- Revisar migration linha a linha.
- Aprovar ADR (status `Aceito`).
- Validar regra jurídica (jurídico VV) e tributária (contador).
- Aceitar fase (relatório com evidências).
- Qualquer coisa em produção.
