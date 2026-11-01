# apps/web · regras locais

Complementa o `AGENTS.md` da raiz. Vale para tudo em `apps/web/`.

## Stack

Vite + React 19 + TypeScript, oxlint, Vitest. A partir da Fase 01 entram (ver ADR-001 e ADR-010): TanStack Query, React Router, React Hook Form + Zod, TanStack Table, Tailwind + shadcn/ui, `vite-plugin-pwa`, `@supabase/supabase-js`, Playwright.

## Regras

- **Só chave pública do Supabase** (`VITE_SUPABASE_ANON_KEY` / publishable). A service role nunca entra aqui, nem em comentário. Tudo que é `VITE_*` vai parar no bundle público.
- **RLS é a autorização.** Esconder botão no front é UX, não segurança. Toda checagem de permissão no front tem par no banco.
- Sem `dangerouslySetInnerHTML`. Texto de edital é exibido como texto. CSP estrita é configurada na Vercel (ADR-002).
- **Mobile-first obrigatório:** toda tela nasce em 360 px. Tabela vira lista de cards abaixo de 768 px, filtros em bottom sheet, ação primária em barra fixa inferior. Teste Playwright roda em viewport de iPhone e desktop.
- Dinheiro chega como `string` e é formatado com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` sobre um decimal (lib a definir na Fase 07). Nunca `parseFloat` em valor monetário.
- Datas exibidas em `America/Sao_Paulo`. Prazos sempre mostram regra usada, data-limite legal e data interna.
- Recurso incompleto aparece com o selo **EM DESENVOLVIMENTO**, nunca como tela falsa.
- A faixa `EnvBanner` não pode ser removida nem escondida fora de produção.

## Estrutura

```text
src/
  features/<modulo>/   telas, hooks e queries de um módulo (empresas, documentos, agenda...)
  components/          design system e componentes compartilhados
  lib/                 supabase client, env, permissões, formatadores BRL/datas
```

Uma feature não importa de outra feature; o que é compartilhado sobe para `components/` ou `lib/`.

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
```
