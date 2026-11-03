# Definition of Done

## Todo PR

- [ ] Ligado a spec `Aprovada` (exceto Fase 00, infra e docs). Requisitos `RF-XX.n` citados na descrição.
- [ ] Um assunto; < 500 linhas alteradas (sem contar lockfiles e tipos gerados).
- [ ] Checks locais do pacote rodados e verdes (colar resultado na descrição).
- [ ] Testes cobrem sucesso, erro e permissão negada.
- [ ] Nenhum segredo, dado real, `float` para dinheiro, credencial de worker/owner/S3 no app ou na API, `dangerouslySetInnerHTML`.
- [ ] Dependência nova registrada (nome, versão, licença, motivo).
- [ ] Docs atualizadas na mesma entrega, conforme [`documentacao-viva.md`](../documentacao-viva.md): spec §7, `em-andamento.md`, roadmap, ADR (decisão nova), modelo de ameaças (ameaça nova), `AGENTS.md` local (regra nova).
- [ ] Descrição separa: testado / implementado sem teste / fora do escopo.

## PR com banco

- [ ] Checklist [`revisao-migration.md`](revisao-migration.md) completo.
- [ ] Teste A x B para cada tabela nova de `priv`; `check_isolation_coverage.py` verde.
- [ ] `db/scripts/test-local.sh` verde (up, rollback de todas, up, pgTAP), local ou no CI.
- [ ] Endpoint novo com e2e A x B em `apps/api/test/`.

## PR com regra (prazos, preços, unidades)

- [ ] Casos de teste com origem humana citada (jurídico/contador/edital real anonimizado).
- [ ] Cobertura ≥ 80% (`precos.py` = 100%).
- [ ] Nenhum valor legal/tributário hardcoded: vem de tabela de parâmetros.

## PR com IA

- [ ] Prompt versionado em `llm/prompts/`, versão registrada na execução.
- [ ] Texto externo delimitado como dado; saída validada por schema.
- [ ] Eval rodado quando muda prompt/modelo/provedor; resultado no PR.
- [ ] Nenhum custo, margem ou dado pessoal no payload.

## PR com front

- [ ] Funciona em 360 px e desktop (print dos dois no PR).
- [ ] Estados carregando / vazio / erro / sem permissão.
- [ ] Recurso incompleto com selo EM DESENVOLVIMENTO.

## Fase

- [ ] Todos os critérios de aceite com evidência (relatório de fase).
- [ ] `auditor-fase` sem PARCIAL/NÃO COMPROVADO, ou lacunas aceitas explicitamente pelo Adriano.
- [ ] `docs/roadmap.md` atualizado.
