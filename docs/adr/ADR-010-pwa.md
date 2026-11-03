# ADR-010 · PWA: `vite-plugin-pwa` + Web Push via VAPID enviado pelo worker

- **Status:** Substituído por ADR-016 (2026-11-02, troca de stack)
- **Data:** 2026-11-01
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Plano (Mobile: PWA instalável + Web Push), Prompt Mestre 3.3, 5.6

## Contexto

Equipe VV acompanha prazos pelo celular. App nativo não se justifica no ano 1.

## Alternativas

| Alternativa | Prós | Contras |
| --- | --- | --- |
| A. **PWA (`vite-plugin-pwa`, Workbox) + Web Push VAPID** | Um código só; instalável; push no Android e iOS ≥ 16.4 (instalado) | Push no iOS só com app instalado na tela inicial |
| B. React Native / Capacitor | Push nativo | Segundo app para manter |

## Decisão

**A.** Service worker com cache do shell (sem cache de dados privados), tela offline, manifest e ícones. Inscrições de push em `core` por usuário; envio pelo worker com chave VAPID em segredo. Conteúdo do push sem dados sensíveis (só "Prazo de impugnação em 2 dias · abra o app").

## Consequências

- **Negativas / risco residual:** iOS exige instalação; e-mail continua como canal de garantia.
- **Gatilho para reavaliar:** necessidade de recurso nativo (biometria, arquivos offline).
