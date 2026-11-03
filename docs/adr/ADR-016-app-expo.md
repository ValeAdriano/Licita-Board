# ADR-016 · App: Expo (React Native) para iOS, Android e Web, com push nativo e Web Push

- **Status:** Aceito (2026-11-02)
- **Data:** 2026-11-02
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Plano (mobile-first), Prompt Mestre 3.3, 5.6 (alertas)
- **Substitui:** ADR-010

## Contexto

A equipe VV acompanha prazos pelo celular, e o push precisa chegar com confiabilidade, o que o PWA no iOS não garante. O acesso pelo navegador do computador continua necessário. O Adriano escolheu React Native em 2026-11-02.

## Alternativas

| Alternativa | Prós | Contras |
| --- | --- | --- |
| A. **Expo + Expo Router + react-native-web (iOS, Android e Web num código só)** | Um código; push nativo; OTA de JS (EAS Update); web para o computador | UI web com cara de app; tabelas largas exigem componente próprio |
| B. Expo só nativo + web React separado | Web mais "web" | Dois fronts para um dev solo |
| C. React Native CLI sem Expo | Controle total | Build nativo manual; sem OTA pronto |

## Decisão

**A.**

- Expo SDK estável mais recente, TypeScript estrito, Expo Router (rotas por arquivo, as mesmas no web).
- Sessão: no nativo, token no `expo-secure-store`; no web, cookie HttpOnly (ADR-012). O cliente HTTP escolhe pelo `Platform.OS`.
- Push: `expo-notifications` (FCM/APNs) no nativo; Web Push com VAPID no web. Os dispositivos ficam em `core.dispositivos_push`; o envio é feito pelo worker. O conteúdo nunca leva dado sensível ("Prazo de impugnação em 2 dias · abra o app").
- Web build servido pelo Caddy, com CSP estrita; nenhum dado privado em cache local.
- Distribuição: web primeiro; lojas (TestFlight / Play interno) quando houver contas Apple/Google.

## Consequências

- **Positivas:** push confiável no iOS; um código só; correções de JS sem passar pela loja.
- **Negativas / risco residual:** revisão das lojas e custo das contas (Apple US$ 99/ano, Google US$ 25 uma vez); a experiência web precisa de cuidado com layout largo.
- **Desvio do Prompt Mestre:** Next.js → Expo (ver ADR-011).
- **Gatilho para reavaliar:** necessidade de SEO/páginas públicas (avaliar site separado) ou web com uso intenso de tabelas complexas.
