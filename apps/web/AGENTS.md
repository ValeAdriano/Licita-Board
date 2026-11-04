# apps/web · regras locais

Front do VV Licitações: React 19 + Vite + TypeScript em PWA (ADR-018). Complementa o `AGENTS.md` da raiz. Os apps nativos (iOS/Android) foram adiados: aqui só existe web.

## Regras

- O front fala **só com a API**, na mesma origem: `/api/...` (proxy do Vite em dev; Caddy em produção). Nada de credencial de banco, S3, worker ou chave-mestra: tudo que é `VITE_*` vai para o bundle público. Variáveis públicas: `VITE_API_URL` (padrão `/api`), `VITE_VV_ENV` (`dev`/`homolog`/`prod`) e `VITE_TURNSTILE_SITEKEY`. Hook e Semgrep bloqueiam credencial aqui.
- **Sessão só em cookie HttpOnly** (`__Host-sessao`, SameSite=Strict) com CSRF por double submit (`X-CSRF-Token`). O JavaScript nunca vê nem guarda o token. Proibido `localStorage`, `sessionStorage` e `indexedDB` para dado de sessão (Semgrep avisa).
- Toda chamada passa por `src/api/cliente.ts` (CSRF, mensagens de erro seguras, 401 e 403 "MFA" tratados, consulta de fundo). Leitura simples com `useGet`. Sem biblioteca de dados por enquanto.
- Cada conjunto de telas só existe na fase certa da sessão (`src/App.tsx`, `Rotas`; testado em `src/App.test.tsx`). Isso é conforto: **quem decide é a API** (guard + RLS). Esconder botão é UX, não segurança.
- Sem `dangerouslySetInnerHTML`. Texto de edital, título de notificação e nome de empresa são exibidos como texto. O nome de empresa é texto livre de terceiro: no convite, sempre junto do CNPJ e de quem convidou.
- **Mobile-first:** toda tela nasce em 360 px; menu lateral só ≥ 1024 px (no celular, cabeçalho com botão que abre o menu). Tabela vira lista de cards no celular. Estados obrigatórios: carregando, vazio, erro, sem permissão, sucesso.
- Dinheiro chega como `string` e é formatado com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` sobre um decimal (lib a definir na Fase 07). Nunca `parseFloat` em valor monetário. Datas em `America/Sao_Paulo`.
- Recurso incompleto aparece com o selo **EM DESENVOLVIMENTO**, nunca como tela falsa. A `FaixaAmbiente` não pode ser removida nem escondida fora de produção.
- PWA: o service worker guarda só os arquivos do app (shell). **Nunca cache de resposta da API** (`runtimeCaching` vazio e `/api` fora do fallback de navegação).
- Web Push (ADR-018): só liga por clique (`Alertas`); o aviso é genérico e o clique abre sempre `/notificacoes` (`public/push.js`, sem URL do payload). Sair da conta (explícito) cancela a inscrição; expirar por inatividade não. A chave pública VAPID vem da API (`GET /push/chave`); nenhuma chave privada aqui.
- Operação crítica (alterar permissões, convidar) passa por step-up: a confirmação mostra o resumo do que será gravado, um envio por vez, nunca reenvia o último código, e "Cancelar" vale também durante o envio (`StepUpModal`).

## Cabeçalhos do Caddy (obrigatórios antes de qualquer uso real; T5.18, B1 da revisão)

Implementados em [`infra/caddy/Caddyfile`](../../infra/caddy/Caddyfile) e testados com o Caddy real por `infra/caddy/testar-cabecalhos.sh` (job `caddy` do CI). **Mudou a política aqui? Mude o Caddyfile e o teste juntos.**

Em todas as respostas, inclusive `/sw.js` (`unsafe-inline` e `unsafe-eval` **não** são necessários: o HTML só tem `<script src>` e o CSS é arquivo próprio). Única exceção em `style-src`: o **hash** do `<style>` que o react-aria (Untitled UI) injeta em runtime para `usePress` (`@layer` com `touch-action` e `-webkit-touch-callout`). **Atualizou o `react-aria-components`?** Abra o app com a CSP e, se o console reclamar de "Applying inline style", troque o hash que o navegador sugere (Caddyfile, este arquivo e o teste):

```text
Content-Security-Policy: default-src 'none'; script-src 'self' https://challenges.cloudflare.com;
  style-src 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='; img-src 'self'; font-src 'self'; connect-src 'self';
  frame-src https://challenges.cloudflare.com; worker-src 'self'; manifest-src 'self';
  form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer          # se o Turnstile falhar, strict-origin; o token fica no # e nunca vai no Referer
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
X-Frame-Options: DENY
```

- Validar em homologação com `Content-Security-Policy-Report-Only`; só acrescentar o que o relatório pedir (ex.: `connect-src https://challenges.cloudflare.com` para o Turnstile). Sem COEP `require-corp` (quebra o iframe do Turnstile).
- Cache: `index.html`, `sw.js`, `push.js`, `manifest.webmanifest` com `no-cache`; `/assets/*` com `public, max-age=31536000, immutable`; `/api/*` nunca cacheado nem com o `no-store` da API sobrescrito. Mudou a CSP? Mude também o `index.html` (o Workbox guarda o HTML com os cabeçalhos da época).
- Rotas: `handle_path /api/*` com `reverse_proxy` (preservar `Origin` e `Sec-Fetch-Site`, que o login usa); fallback de SPA só fora de `/api` e de `/.well-known`. Tirar `X-Csrf-Token` dos logs. `CORS_ORIGINS` da API = a origem https do app.

## Design (Untitled UI, ADR-020)

Todos os componentes vêm do **Untitled UI React** (`src/components`, copiados pelo CLI `untitledui`, só os gratuitos) sobre react-aria e Tailwind 4; as telas usam a camada em `src/ui` (nomes em português). Tokens e tema em `src/styles/theme.css` (marca azul, Inter local).

- Tela nova: componentes de `src/ui` (ou `src/components`) e classes Tailwind com os tokens do tema (`text-primary`, `bg-secondary`, `ring-secondary`...). **Nada de CSS próprio nem `style={{}}`** (a CSP bloqueia estilo inline).
- Layout: menu lateral a partir de 1024 px e cabeçalho com menu em painel no celular; página = `Pagina` + `CabecalhoPagina`; blocos em `Cartao`; abas com `Abas`; alertas com `Aviso`; selos com `Etiqueta`. Uma ação primária por tela.
- Claro/escuro: o tema do Untitled UI usa a classe `dark-mode` (hoje só o claro está ligado); contraste e alvos de toque seguem o padrão do sistema. `prefers-reduced-motion` respeitado.
- Componente copiado que precise de ajuste: edite o arquivo e registre o ajuste no ADR-020 (o `--overwrite` do CLI o desfaz).

## Estrutura

```text
src/
  api/        cliente HTTP único
  auth/       sessão (provider), links (funções puras), fragmento (token de redefinição)
  features/   acesso/ (contexto, matriz, conta/, equipe/): uma feature não importa de outra
  pages/      uma por rota
  components/ Untitled UI (copiado pelo CLI) · ui/ camada fina em português · styles/ tema
```

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Dev: `npm run dev` em `http://localhost:5173` com a API em `localhost:3000` (`VV_API_DEV_URL` muda o alvo do proxy).

Conferir no navegador (`npm run dev`) em 360 px e desktop, claro e escuro, antes de dar a tela por pronta.
