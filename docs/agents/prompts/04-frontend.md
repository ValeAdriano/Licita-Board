# Prompt · 04 Frontend

> Troque `<...>`. Pré-requisito: migration no `main` e tipos em `packages/shared`.

Implemente a tela/feature **"<nome>"** da spec `docs/specs/fase-<XX>.md` (requisitos `<RF-XX.n>`).

**Leia antes:** `AGENTS.md`, `apps/web/AGENTS.md`, a seção de telas e permissões da spec.

**Faça:**
1. Comece em 360 px. Abaixo de 768 px: cards em vez de tabela, filtros em bottom sheet, ação primária em barra fixa inferior.
2. Estados: carregando, vazio, erro, sem permissão, sucesso. Mensagens em português claro.
3. Dados pela API, só por `src/api/cliente.ts` (mesma origem, sessão em cookie). Formulários com React Hook Form + Zod (schemas de `packages/shared` quando existirem).
4. Permissão no front só esconde/desabilita; a regra real é a API (guard) e o RLS. Teste o caso "sem permissão" contra a API local.
5. Dinheiro como string formatada em BRL; datas em America/Sao_Paulo.
6. Testes: unidade (Vitest) para lógica; Playwright para o caminho principal em viewport mobile e desktop.
7. Rode `npm run lint && npm run typecheck && npm test && npm run build` e cole o resultado.

**Não faça:** credencial de banco ou chave-mestra no front; `dangerouslySetInnerHTML`; tela "de mentira" (use o selo EM DESENVOLVIMENTO); importar de outra feature.
