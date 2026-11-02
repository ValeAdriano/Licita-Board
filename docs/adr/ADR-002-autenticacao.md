# ADR-002 · Autenticação: Supabase Auth adaptado

- **Status:** Proposto
- **Data:** 2026-11-01
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 1.4 (Autenticação, Operações críticas)

## Contexto

O Prompt pede Argon2id ou bcrypt custo ≥ 12, senha ≥ 12, bloqueio de senha vazada, MFA obrigatório por perfil, bloqueio progressivo, sessão em cookie HttpOnly com inatividade de 30 min e absoluta de 12 h, revogação de sessões, recuperação neutra de 30 min, reautenticação em operações críticas.

## Alternativas

| Alternativa | Prós | Contras | Custo |
| --- | --- | --- | --- |
| A. Supabase Auth adaptado | Pronto, MFA TOTP nativo, leaked password, rate limit, sessões time-box (Pro) | bcrypt custo 10; JWT no client | incluso no Pro |
| B. Auth próprio no FastAPI (Argon2id + cookie) | Atende o Prompt à risca | Muito código crítico escrito por dev solo; RLS precisa de JWT compatível de qualquer jeito | horas de dev + manutenção |
| C. Provedor externo (Auth0/Clerk) | Recursos avançados | Custo por usuário, integração com RLS mais complexa | US$ 25+ |

## Decisão

**A**, com compensações:

| Requisito | Implementação |
| --- | --- |
| Hash forte | bcrypt do Supabase (custo 10) compensado por senha ≥ 12 com maiúscula/minúscula/dígito, leaked password protection e MFA obrigatório |
| MFA por perfil | TOTP nativo; `core.has_permission` exige `aal2` para perfis internos; códigos de recuperação de uso único (Fase 01) |
| Força bruta | Rate limit do Auth + CAPTCHA do Auth após N tentativas (avaliar na Fase 01) |
| Sessão | JWT 15 min (`jwt_expiry = 900`), refresh rotativo, time-box 12 h e inatividade 30 min (config Pro) + logout por inatividade no front |
| Cookie HttpOnly | **Não atendido.** Mitigação: CSP estrita, sem `dangerouslySetInnerHTML`, sanitização, JWT curto |
| Revogação | "Sair de todos os dispositivos" via `signOut({ scope: 'global' })` |
| Recuperação | Fluxo do Auth com mensagem neutra no front; validade de 30 min configurada no projeto |
| Cadastro | `enable_signup = false`: usuários são convidados |
| Step-up | Novo desafio TOTP (≤ 2 min, claim `amr`) com fator cadastrado há ≥ 24 h → `core.step_up_tokens`: um token por verificação, 5 min, uso único, preso à sessão viva; consumido pela função da operação crítica |

## Notas de implementação (Fase 01)

- O step-up lê `amr`, `aal` e `session_id` do JWT e `auth.sessions`/`auth.mfa_factors`. Um Custom Access Token Hook, se criado, precisa preservar esses claims.
- Só TOTP é aceito no step-up; WebAuthn/telefone falham fechado até nova migration.
- Fator MFA cadastrado há menos de 24 h não autoriza operação crítica (mitiga sessão roubada que cadastra fator próprio).

## Consequências

- **Negativas / risco residual:** XSS vira roubo de sessão (médio). bcrypt 10 abaixo do pedido (baixo, com MFA).
- **Desvio do Prompt Mestre:** custo do bcrypt e cookie HttpOnly. Ambos registrados aqui e no modelo de ameaças (T5).
- **Gatilho para reavaliar:** virada SaaS, pentest apontando XSS explorável, ou Supabase oferecer Argon2id/cookie HttpOnly nativo.
