# ADR-012 · Autenticação própria na API: Argon2id, sessão opaca, TOTP e step-up

- **Status:** Proposto
- **Data:** 2026-11-02
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 1.4 (Autenticação, Operações críticas)
- **Substitui:** ADR-002

## Contexto

Sem o Supabase Auth, a API passa a ser dona da identidade. O Prompt pede Argon2id (ou bcrypt ≥ 12), senha ≥ 12, bloqueio de senha vazada, MFA obrigatório por perfil, bloqueio progressivo, sessão em cookie HttpOnly com inatividade de 30 min e absoluta de 12 h, revogação, recuperação neutra de 30 min e reautenticação em operações críticas. O app nativo não tem cookie de navegador.

## Alternativas

| Alternativa | Prós | Contras | Custo |
| --- | --- | --- | --- |
| A. **Auth própria na API com sessão opaca no banco** | Atende o Prompt à risca; revogação imediata; sem fornecedor | Código crítico nosso | horas de dev |
| B. Keycloak / Zitadel em container | Recursos prontos (MFA, políticas) | Mais um serviço pesado para operar; integração com RLS e step-up continua sendo nossa | RAM do servidor |
| C. Provedor externo (Auth0, Clerk) | Pronto | Custo por usuário; dado de identidade fora do Brasil | US$ 25+ |
| D. JWT stateless | Sem consulta por requisição | Revogação e inatividade difíceis; pior que a revisão 1 | — |

## Decisão

**A.**

| Requisito | Implementação |
| --- | --- |
| Hash | Argon2id (`argon2`, parâmetros OWASP: m=19 MiB, t=2, p=1), rehash automático se os parâmetros subirem |
| Senha | ≥ 12 caracteres; consulta HIBP por k-anonymity (só os 5 primeiros caracteres do SHA-1 saem do servidor); se o HIBP falhar, cai para uma lista local das senhas mais comuns |
| Força bruta | `core.tentativas_login` por usuário e por IP com atraso progressivo e bloqueio temporário; `@nestjs/throttler` no login, na recuperação e no MFA |
| Sessão | Token aleatório de 256 bits; o banco guarda só o SHA-256 em `core.sessoes` (usuário, `aal`, criada, último uso, expira, IP, user-agent, revogada). Inatividade de 30 min, absoluta de 12 h, rotação do token no login e no step-up |
| Transporte web | Cookie `__Host-sessao` HttpOnly, Secure, SameSite=Strict, Path=/; token CSRF em header (double submit) em toda requisição que altera estado |
| Transporte nativo | `Authorization: Bearer <token>`; token só no `expo-secure-store` (Keychain/Keystore) |
| MFA | TOTP (`otplib`), segredo cifrado em campo (ADR-017), obrigatório para SUPERADMIN, ADMIN_EMPRESA, OPERADOR e JURÍDICO (a sessão fica `aal1` até o TOTP); 10 códigos de recuperação de uso único com hash Argon2id. Passkey fica para depois |
| Revogação | "Sair de todos os dispositivos" revoga todas as sessões do usuário; troca de senha também revoga |
| Recuperação | Token de uso único (hash no banco), 30 min, mensagem sempre neutra, envio por e-mail pelo worker |
| Cadastro | Fechado: usuários entram por convite (Fase 01) |
| Step-up | TOTP novo (≤ 2 min), fator cadastrado há ≥ 24 h → `core.step_up_tokens` (5 min, uso único, preso à sessão), consumido pela operação crítica |

## Consequências

- **Positivas:** fecha os desvios da ADR-002 (bcrypt 10 e JWT no client). Revogação vale na hora, porque toda requisição consulta a sessão.
- **Negativas / risco residual:** auth própria é o código mais sensível do projeto. Mitigações: bibliotecas maduras, testes de ataque (força bruta, replay de TOTP, fixação de sessão, CSRF), revisão `revisor-seguranca` em todo PR do módulo e pentest antes do 1º cliente real.
- **Desvio do Prompt Mestre:** no app nativo a sessão não fica em cookie (não se aplica). O token fica no armazenamento seguro do sistema operacional, com as mesmas regras de expiração.
- **Gatilho para reavaliar:** exigência de SSO corporativo (SAML/OIDC) por cliente → avaliar Keycloak/Zitadel.
