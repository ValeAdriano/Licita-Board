# Prompt · Revisão de PR

> Use um agente diferente do autor. Troque `<base>` pelo commit anterior à entrega (ou use `main...<branch>` se veio de worktree).

Revise `git diff <base>..HEAD` do VV Licitações. Não edite: aponte achados.

**Leia antes:** `AGENTS.md` (§3 regras invioláveis, §8 DoD), a spec da fase, `docs/threat-model.md`, e o `AGENTS.md` local de cada pasta tocada.

**Verifique, em ordem de gravidade:**
1. Isolamento entre empresas: RLS, `has_permission`, worker validando `empresa_id`, testes A x B.
2. Segredos e dados: service role no front, segredo versionado, PII em log, dado real em fixture.
3. Correção de regra: prazos, dinheiro (`Decimal`/`numeric`), unidades, máquina de estados. Regra legal sem validação marcada?
4. IA: texto externo como dado, saída validada, nada de ATENDE sem evidência, nada sensível enviado ao provedor.
5. Testes: cobrem erro e permissão? Rodaram de verdade? Cobertura de `rules/`.
6. Escopo: < 500 linhas por commit, um assunto, sem tela ilustrativa, dependências registradas no commit.
7. Mobile-first e estados de tela (front).

**Formato:** `BLOQUEANTE` / `IMPORTANTE` / `SUGESTÃO`, cada um com `arquivo:linha`, problema, cenário concreto de falha e correção sugerida. Termine com "o que conferi e está ok".
