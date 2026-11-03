# ADR-018 · Front: React web (Vite) em PWA, com design Apple; apps nativos adiados

- **Status:** Aceito (2026-11-03)
- **Data:** 2026-11-03
- **Decisor:** Adriano Vale (pedido na conversa de 2026-11-03: "migrar para React ao invés de React Native e fazer o layout com a skill Apple design")
- **Requisito relacionado:** Plano (mobile-first), Prompt Mestre 3.3 e 5.6 (alertas), ADR-012 (sessão)
- **Substitui:** ADR-016

## Contexto

O ADR-016 escolheu Expo (React Native) para iOS, Android e Web num código só. Com o front de acesso pronto (login, MFA, shell, conta, equipe), o Adriano preferiu um front React para a web, com visual próprio inspirado no design da Apple, e abriu mão dos apps nativos por enquanto. O uso real é no navegador do computador e no celular; o push no celular fica por Web Push com o app instalado na tela inicial (PWA).

## Alternativas

| Alternativa | Prós | Contras |
| --- | --- | --- |
| A. **React + Vite (SPA), PWA instalável, CSS próprio com tokens** | Telas de web de verdade (tabelas, formulários largos); sessão só em cookie HttpOnly (token nunca no JS); sem custo de contas Apple/Google | Sem app nas lojas; push no iPhone só com o PWA instalado; sem bloqueio de captura de tela |
| B. Manter Expo e só refazer o visual | Mantém o caminho para as lojas | UI web com cara de app; tabelas largas exigem componente próprio |
| C. React web + Expo nativo depois, compartilhando `packages/shared` | Flexível | Dois fronts para um dev solo; adiável até haver demanda |

## Decisão

**A.**

- **Pacote:** `apps/web` (Vite 8 + React 19 + TypeScript estrito + React Router). Substitui o front da revisão 1 (Supabase) e o `apps/app` (Expo), que saem do repositório quando o equivalente estiver completo.
- **Sessão:** só cookie `__Host-sessao` (HttpOnly, Secure, SameSite=Strict) com CSRF por double submit (`X-CSRF-Token`). O JavaScript nunca vê o token de sessão. O caminho Bearer da API continua para integrações e para um app nativo futuro.
- **Mesma origem:** o front chama `/api/...` na própria origem (proxy do Vite em dev, Caddy em produção). Sem CORS em produção e CSP com `connect-src 'self'`.
- **Visual:** design system próprio em CSS com variáveis (tokens) a partir da skill `apple-ui-design`: fonte do sistema, escala 4/8/16/24/48, cartões de 18 px, botões em pílula, modo claro e escuro, alvos de toque ≥ 44 px, contraste ≥ 4,5:1 (o cinza secundário da skill, #86868b, não passa: usamos #6e6e73). Sem biblioteca de componentes.
- **PWA:** `vite-plugin-pwa`; o service worker guarda só os arquivos do app (shell), nunca resposta da API.
- **Push:** Web Push com VAPID (envio pelo worker; `core.dispositivos_push` tipo `webpush`). No iPhone exige o app instalado. Conteúdo sem dado sensível.
- **Ícones:** `lucide-react` (ISC).
- **Dados:** leitura simples com hooks próprios (`useGet`); sem TanStack Query por enquanto.

## Consequências

- **Positivas:** um front de web de verdade; a sessão fica mais segura (sem armazenamento de token no cliente); menos dependências; sem custo de lojas.
- **Negativas / risco residual:** sem app nas lojas e sem push nativo; no iPhone o push depende do PWA instalado; bloqueio de captura de tela dos códigos de recuperação não existe no navegador (a proteção é a tela sumir ao sair e ao ir para o segundo plano).
- **Desvio do plano:** ADR-016 e os itens "iOS/Android" do plano e do PR 9 (push) mudam para web/PWA.
- **Gatilho para reavaliar:** necessidade de push nativo confiável no iPhone, de câmera/leitor de código de barras ou de distribuição pelas lojas. Caminho: Capacitor sobre este mesmo front, ou Expo consumindo `packages/shared`.

## Custo

Sem custo mensal novo; deixa de existir a anuidade da Apple (US$ 99) e o Expo EAS do plano.
