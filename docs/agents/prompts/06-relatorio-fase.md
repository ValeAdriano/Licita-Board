# Prompt · 06 Relatório de fase

> Troque `<XX>`.

Gere `docs/phase-reports/fase-<XX>.md` a partir de `docs/phase-reports/_modelo.md`.

**Regras de honestidade (Prompt Mestre):**
- "Testado e aprovado" só com evidência que você conferiu agora: nome do teste + resultado real, link do CI, print em `docs/phase-reports/evidencias/fase-<XX>/`.
- Implementado e não testado vai na seção própria. Não arredonde.
- Critério de aceite sem evidência = fase não concluída. Diga isso no topo.

**Passos:**
1. Liste os critérios de aceite do Prompt Mestre e da spec.
2. Para cada um, encontre a evidência (rode os testes: web, API (unitário e e2e), worker, `db/scripts/test-local.sh`, `check_isolation_coverage.py`, Semgrep, e confira o CI).
3. Liste arquivos/componentes criados (`git diff --stat <tag-fase-anterior>..HEAD`), alterações no banco (migrations), integrações operacionais.
4. Atualize `docs/threat-model.md` se surgiram ameaças; liste no relatório.
5. Recomende a próxima fase e as dependências pendentes (jurídico, contador, operação VV).

Status do relatório: `Aguardando aceite`. O aceite é do Adriano.
