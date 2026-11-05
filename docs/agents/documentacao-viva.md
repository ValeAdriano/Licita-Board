# Documentação viva

> **Modo rápido (AGENTS.md §0, 2026-11-04):** este documento é orientação para quando o projeto sair do protótipo. Hoje: tudo direto no `main`, sem PR, sem CI, sem revisores nem relatório; teste só o que acelera.


A documentação deste repositório é a memória do projeto: o próximo agente (ou o Adriano, semanas depois) só sabe o que está escrito. Por isso **toda entrega atualiza a documentação no mesmo commit do código**, nunca "depois". Vale para qualquer agente (Claude Code, Antigravity, Codex, Cursor...) e para humanos.

Regra de ouro: se o código e o documento discordam, o trabalho não terminou.

## O que atualizar, conforme o que mudou

| Mudou... | Atualize |
| --- | --- |
| Qualquer bloco de trabalho concluído (sempre) | **`docs/agents/COMECE-AQUI.md`**: o que mudou no estado, o que ficou pendente, os próximos passos em ordem, armadilhas novas |
| Terminou um PR da fase | `docs/specs/fase-XX.md` §7 (marcar ✅ e anotar pendências), `docs/agents/em-andamento.md`, `docs/roadmap.md` (linha da fase e "Próximo passo") |
| Começou ou pausou uma tarefa | `docs/agents/em-andamento.md` (uma linha por tarefa ativa; handoff ao pausar, modelo em [`handoff.md`](handoff.md)) |
| Comportamento diferente do que a spec diz | Pare e pergunte ao Adriano; aprovada a mudança, edite a spec na mesma entrega |
| Decisão de arquitetura nova (lib, serviço, padrão, troca de abordagem) | ADR novo em `docs/adr/` (modelo em [`prompts/nova-adr.md`](prompts/nova-adr.md)); status `Proposto` até o Adriano aceitar |
| Controle de segurança novo, ameaça nova ou risco aceito | `docs/threat-model.md` (linha com controle, teste, fase e status: implementado / planejado / aceito) |
| Tabela, função ou regra nova no banco | Comentário no topo da migration explicando o porquê; `db/AGENTS.md` se nasceu regra para quem escreve migration |
| Regra nova para quem mexe num pacote | `AGENTS.md` local do pacote (`apps/web`, `apps/worker`, `db`) |
| Comando novo, porta, variável de ambiente, script | `AGENTS.md` raiz §6 (comandos) e o `AGENTS.md` do pacote; variável pública do front em `apps/web/AGENTS.md` |
| Dependência nova | Corpo do commit: nome, versão, licença e motivo |
| Termo de licitação novo | [`glossario.md`](glossario.md) |
| Fim de fase | `docs/phase-reports/fase-XX.md` com evidências reais ([`prompts/06-relatorio-fase.md`](prompts/06-relatorio-fase.md)) e `docs/roadmap.md` |
| Backup, restauração ou segredo de operação | `infra/backup/README.md` (runbook) e o ensaio trimestral em `docs/phase-reports/evidencias/` |
| Algo pendente para o Adriano (decisão, conta, fornecedor) | Tabela "Dependências externas abertas" em `docs/roadmap.md` |
| Documento que você leu está desatualizado | Corrija na mesma entrega (ou registre no handoff, se fugir do escopo) |

## Checklist de fim de tarefa

Antes de dizer que terminou:

- [ ] Spec, quadro (`em-andamento.md`) e roadmap refletem o estado real.
- [ ] Threat-model e ADR atualizados se houve controle, risco ou decisão nova.
- [ ] O que foi **testado**, o que foi **implementado sem teste** e o que **ficou de fora** está escrito (corpo do commit e, se for pendência, na spec ou no threat-model).
- [ ] Nenhum documento cita caminho, comando ou tecnologia que não existe mais.

## Como escrever

- Português, frases curtas, no presente ("a API confere...", não "a API irá conferir").
- Diga o estado real: `implementado`, `planejado`, `aceito`. Nunca marque como feito o que não foi testado.
- Links relativos para arquivos do repositório.
- Data absoluta (2026-11-03), nunca "ontem" ou "semana que vem".
