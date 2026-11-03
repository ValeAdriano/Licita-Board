# Spec · Fase 01 · Arquitetura, segurança e controle de acessos

- **Status:** Rascunho (revisão 2: stack nova, auth própria) — aguarda aprovação
- **Onda:** 1 — Fundação
- **Autor:** Claude Code · **Aprovação:** pendente (Adriano Vale)
- **Validação jurídica:** LGPD (contrato operador/controlador) — pendente
- **Fontes:** Prompt Mestre Fase 01 (1.1–1.5); Plano (revisão 2), Fase 01 e "Modelo de dados núcleo e RLS"; ADR-012, ADR-013, ADR-015, ADR-016, ADR-017

> A revisão 1 desta fase foi implementada sobre o Supabase (`supabase/migrations`, `apps/web`) e está congelada. As regras de negócio dela foram aprovadas na prática e **continuam valendo**; esta revisão muda só a infraestrutura: identidade e sessão passam a ser da API, e o contexto do usuário passa a ser conferido no banco.

## 1. Escopo

**Entra:** port do schema de acesso e auditoria para `db/`; autenticação própria (senha, sessão, MFA TOTP, códigos de recuperação, recuperação de senha, bloqueio progressivo, step-up); contexto do usuário validado contra `core.sessoes`; API de acesso (empresas mínimas, vínculos, permissões, convites, notificações, exclusão com dupla aprovação, auditoria); app (login, MFA, recuperação, shell, seletor de empresa, notificações, conta, matriz e convites); registro de push; inventário LGPD; backup com restauração testada.

**Não entra:** campos completos de empresa, dados bancários/PIX, representantes (Fase 02); documentos e S3 (Fase 03); tabelas de `priv` (a partir da Fase 02); passkeys (depois).

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-01.1 | Schemas, UUID v7, `updated_at` automático (feito na Fase 00 + port) | Plano; Prompt 1.4 |
| RF-01.2 | `audit.audit_log` insert-only: quem, o quê, quando, IP, empresa, antes/depois | Prompt 1.4 Auditoria |
| RF-01.3 | `core.empresas` com CNPJ validado (numérico e alfanumérico) | Prompt 2.1, 1.4 |
| RF-01.4 | Perfis SUPERADMIN, ADMIN_EMPRESA, OPERADOR, JURÍDICO, CLIENTE | Prompt 1.2 |
| RF-01.5 | Matriz empresa × módulo × 12 ações, negar por padrão | Prompt 1.3 |
| RF-01.6 | Isolamento em duas camadas; A x B por tabela (pgTAP) e por endpoint (e2e) | Prompt 1.4; ADR-013 |
| RF-01.7 | Senha Argon2id, mínimo 12, bloqueio de senha vazada | Prompt 1.4; ADR-012 |
| RF-01.8 | Bloqueio progressivo por usuário e IP | Prompt 1.4 |
| RF-01.9 | Sessão: cookie HttpOnly/Secure/SameSite (web), token no SecureStore (nativo); inatividade 30 min, absoluta 12 h; revogação de todas | Prompt 1.4; ADR-012 |
| RF-01.10 | MFA TOTP obrigatório para perfis internos; códigos de recuperação de uso único | Prompt 1.4 |
| RF-01.11 | Recuperação de senha por token de uso único, 30 min, sem revelar se o e-mail existe | Prompt 1.4 |
| RF-01.12 | Step-up (token de 5 min) em operações críticas | Prompt 1.4 |
| RF-01.13 | Exclusão definitiva só SUPERADMIN, com dupla aprovação | Prompt 1.3 |
| RF-01.14 | Shell: menu lateral (web largo) / abas (celular), notificações, conta, seletor de empresa | Prompt 1.1 |
| RF-01.15 | Push: registro de dispositivo (Expo) e inscrição Web Push | ADR-016 |
| RF-01.16 | Backup externo + restauração testada | Prompt 1.4 Backup; ADR-015 |
| RF-01.17 | Inventário LGPD e minuta operador/controlador | Prompt 1.5 |

## 3. O que vem da revisão 1 (port)

As migrations `supabase/migrations/2026110112*–16*` e os testes `supabase/tests/*` são portados para `db/` com estas trocas mecânicas. Regras, colunas, constraints e testes de negócio ficam iguais.

| Revisão 1 (Supabase) | Revisão 2 |
| --- | --- |
| `auth.uid()` | `core.usuario_atual()` |
| `auth.jwt()->>'aal'`, `core.mfa_ok()` | `core.aal_atual() = 'aal2'` |
| `auth.jwt()->>'session_id'`, `auth.sessions` | `core.sessao_atual()`, `core.sessoes` |
| `auth.mfa_factors` | `core.fatores_mfa` |
| claim `amr` (instante do TOTP) | `core.sessoes.mfa_em` |
| `auth.users` + trigger de perfil | `core.usuarios` é a própria tabela de identidade |
| papel `authenticated` | `vv_api` |
| papel `service_role` | `vv_worker` |
| `anon` | sem papel: só os endpoints públicos da API (login, recuperação, health) |
| RPC chamada pelo front | endpoint da API que chama a mesma função dentro de `comContexto` |

Itens portados sem mudança de regra: `core.empresas`, `core.modulos`, `core.vinculos`, `core.permissoes`, `core.has_permission`, `core.is_superadmin`, `core.cnpj_valido`, `audit.audit_log` + `audit.registrar()`, `core.step_up_tokens` (iniciar/consumir), `core.aprovacoes_exclusao` (solicitar/decidir/executar), `core.notificacoes`, `core.convites`, `core.salvar_vinculo`, `core.definir_permissoes`, regra do teto de concessão e do "ao menos um admin", e as regras de negócio da seção 6.

## 4. Modelo de dados novo (identidade e sessão)

### `core.usuarios` (passa a ser a identidade)

Colunas da revisão 1 (`nome`, `telefone`, `oab`, `superadmin`, `ativo`) mais:

| Coluna | Tipo | Regra |
| --- | --- | --- |
| email | citext | único, normalizado; troca exige confirmação no e-mail novo (fora desta fase) |
| senha_hash | text | Argon2id (PHC string); **sem grant de leitura para `vv_api`** |
| senha_trocada_em | timestamptz | revoga sessões anteriores |
| bloqueado_ate | timestamptz | bloqueio progressivo |
| mfa_obrigatorio | boolean | calculado: perfil interno em qualquer vínculo ativo ou SUPERADMIN |

### Tabelas novas

| Tabela | Conteúdo | Acesso de `vv_api` |
| --- | --- | --- |
| `core.sessoes` | `usuario_id`, `token_hash` (SHA-256), `aal`, `mfa_em`, `criada_em`, `ultimo_uso_em`, `expira_em` (12 h), `revogada_em`, `ip`, `user_agent`, `plataforma` | nenhum direto; só por funções `security definer` |
| `core.fatores_mfa` | `usuario_id`, `tipo` ('totp'), `segredo_cifrado` (envelope, ADR-017), `verificado_em`, `ultimo_passo` (anti-replay) | nenhum |
| `core.codigos_recuperacao` | `usuario_id`, `codigo_hash` (Argon2id), `usado_em` | nenhum |
| `core.tentativas_login` | `email_hash`, `ip`, `sucesso`, `em` | nenhum |
| `core.tokens_recuperacao` | `usuario_id`, `token_hash`, `expira_em` (30 min), `usado_em` | nenhum |
| `core.dispositivos_push` | `usuario_id`, `tipo` (expo/webpush), `endereco`, `criado_em`, `revogado_em` | o próprio usuário |

### Contexto validado no banco (ADR-013, Fase 01)

- `core.definir_contexto(p_token text)` passa a receber **só o token opaco** da sessão. É `security definer`: busca `core.sessoes` por `sha256(token)`, confere `revogada_em is null`, `expira_em > now()` e inatividade (`ultimo_uso_em > now() - 30 min`), atualiza `ultimo_uso_em` e grava usuário, sessão e `aal` no contexto da transação.
- A sessão só sobe para `aal2` por `core.confirmar_mfa(p_token, p_passo_totp)`, depois que a API confere o TOTP. **Ver pergunta aberta 1**: conferir o TOTP no próprio banco fecha o risco de um SQLi elevar a própria sessão.
- Login e criação de sessão: `core.criar_sessao(...)` (`security definer`), chamada pela API depois de conferir a senha. A API nunca lê `senha_hash` por SELECT: usa `core.hash_do_login(email)`, que devolve o hash só para o fluxo de login e registra a tentativa.

## 5. API (NestJS)

Todo endpoint autenticado passa por `SessaoGuard` (cookie `__Host-sessao` ou `Authorization: Bearer`) e declara `@Permissao(modulo, acao)` ou `@SoAutenticado()`. Endpoints que alteram estado exigem token CSRF no web. Respostas de erro não revelam se e-mail, empresa ou recurso existe (404 para recurso de outra empresa).

| Grupo | Endpoints |
| --- | --- |
| Auth público | `POST /auth/login`, `POST /auth/recuperar`, `POST /auth/redefinir` |
| Sessão | `POST /auth/mfa/verificar`, `POST /auth/mfa/recuperacao` (código de uso único), `POST /auth/logout`, `POST /auth/logout-todas`, `GET /auth/sessoes`, `DELETE /auth/sessoes/:id`, `POST /auth/senha` (trocar logado, exige a atual) |
| MFA | `POST /auth/mfa/cadastrar` (QR + segredo uma vez), `POST /auth/mfa/confirmar`, `POST /auth/mfa/codigos` (gera 10 novos, mostra uma vez, exige step-up) |
| Step-up | `POST /auth/step-up` (TOTP novo → token de 5 min do escopo) |
| Conta | `GET /me` (perfil, vínculos, permissões por empresa), `PATCH /me` (nome, telefone, OAB) |
| Acesso | `GET/POST /empresas`, `GET/PATCH /empresas/:id`; `GET /empresas/:id/usuarios`; `PUT /vinculos/:id` (salvar_vinculo com step-up); convites (`POST`, `DELETE`, `GET /me/convites`, `POST /me/convites/:id/aceitar`) |
| Exclusão | `POST /exclusoes` (solicitar), `POST /exclusoes/:id/decidir` |
| Notificações | `GET /notificacoes`, `POST /notificacoes/:id/lida`, `POST /dispositivos-push`, `DELETE /dispositivos-push/:id` |
| Auditoria | `GET /empresas/:id/auditoria` (`auditoria/visualizar`) |

Parâmetros de segurança (ADR-012): Argon2id m=19 MiB, t=2, p=1; atraso progressivo a partir da 3ª falha e bloqueio de 15 min na 10ª (por e-mail e por IP); rate limit de 10/min por IP em login, recuperação e MFA; TOTP com janela de ±1 passo e sem reuso do mesmo passo.

## 6. Regras de negócio (mantidas da revisão 1)

1. Negar por padrão: sem linha em `core.permissoes`, não há acesso. Não existe permissão implícita por papel no banco.
2. Revogação vale na próxima requisição (permissões e sessão consultadas a cada transação).
3. Usuário ou vínculo inativo, ou empresa arquivada, não acessa nada.
4. Perfis internos sem `aal2` não acessam dado da empresa; CLIENTE pode usar `aal1` só para visualizar.
5. Auditoria ignora UPDATE que só muda `updated_at`.
6. CLIENTE só recebe a ação `visualizar`.
7. Dado pessoal de `core.usuarios` vai como `[redigido]` na auditoria; `senha_hash` e segredos nunca entram na auditoria.
8. IP da auditoria vem do Caddy (`X-Forwarded-For` confiável só do proxy local), repassado pela API ao contexto.
9. Colunas sensíveis (CNPJ, `ativo`, `deleted_at`, `created_by`, `superadmin`, `usuario_id`, `empresa_id`, `senha_hash`) não são graváveis por `vv_api`; mudanças vão por função com step-up.
10. Step-up: fator TOTP verificado há ≥ 24 h; uma verificação = um token; uso único; preso à sessão viva.
11. Dupla aprovação: outro SUPERADMIN decide em até 72 h; registro imutável.
12. Notificação: criada só pelo worker; visível só ao destinatário enquanto ele tiver `<modulo>/visualizar`; link só interno.
13. Convite: preso à conta do convidado; vale 7 dias; resposta igual exista ou não a conta.
14. Permissões padrão por papel são só **sugestão na tela** (decidido na revisão 1).

## 7. Plano de PRs (cada um < 500 linhas)

1. `feat/fase-01-port-acesso`: empresas, modulos, vinculos, permissoes, has_permission, audit + pgTAP portados (contexto da Fase 00).
2. `feat/fase-01-identidade`: colunas de identidade em usuarios, sessoes, fatores_mfa, codigos, tentativas, tokens; `definir_contexto(token)`, `criar_sessao`, `confirmar_mfa`; pgTAP.
3. `feat/fase-01-api-auth`: módulo auth (login, logout, sessões, recuperação, troca de senha), `SessaoGuard`, CSRF, `comContexto`, e-mail via fila; e2e de ataque (força bruta, fixação de sessão, CSRF, enumeração de e-mail).
4. `feat/fase-01-api-mfa`: cadastro/confirmação TOTP, códigos de recuperação, step-up; e2e (replay de TOTP, fator novo < 24 h).
5. `feat/fase-01-port-stepup-exclusao`: step_up_tokens, aprovacoes_exclusao, salvar_vinculo, convites, notificacoes no banco + endpoints + e2e A x B.
6. `feat/fase-01-app-auth`: login, MFA, recuperação, sessão no SecureStore/cookie, logout por inatividade.
7. `feat/fase-01-app-shell`: shell, seletor de empresa, notificações, conta (sessões, autenticador, códigos).
8. `feat/fase-01-app-matriz`: matriz de permissões e convites.
9. `feat/fase-01-push`: dispositivos e envio pelo worker.
10. `chore/fase-01-backup`: WAL + base semanal cifrados para bucket externo, restauração documentada.
11. `docs/relatorio-fase-01` e remoção de `supabase/` e `apps/web`.

## 8. Critérios de aceite

| # | Critério | Como será comprovado |
| --- | --- | --- |
| CA-1 | SUPERADMIN e ADMIN_EMPRESA acessam só o que administram | pgTAP de isolamento + e2e |
| CA-2 | OPERADOR e JURÍDICO acessam só empresas autorizadas | pgTAP + e2e |
| CA-3 | CLIENTE não acessa outra empresa nem alterando a requisição | e2e A x B em todo endpoint |
| CA-4 | Acessos e alterações relevantes auditáveis | pgTAP `audit_log` + e2e |
| CA-5 | Dados persistem após sair e entrar | e2e |
| CA-6 | Restauração de backup testada | relatório |
| CA-7 | Ataques de auth barrados: força bruta, replay de TOTP, fixação de sessão, CSRF, enumeração de e-mail, sessão expirada/revogada | e2e dedicados |
| CA-8 | Contexto forjado não vale: valor de sessão, token de outra pessoa, sessão revogada | pgTAP `002_contexto` ampliado |

## 9. Perguntas abertas

1. **Quem confere o TOTP?** (a) a API confere e chama `confirmar_mfa` — mais simples; um SQLi na API consegue elevar a própria sessão; (b) o banco confere (segredo sem grant para `vv_api`, HMAC via `pgcrypto`) — fecha esse risco, mas o segredo fica decifrável pelo banco. Recomendação: **(b)**, com o segredo cifrado pela chave-mestra e decifrado só dentro da função.
2. **Senha vazada:** consultar o HIBP por k-anonymity (só 5 caracteres do hash saem do servidor) é um serviço externo novo. Recomendação: sim, com fallback para uma lista local das 100 mil senhas mais comuns.
3. **E-mail transacional** (recuperação, convite, alerta de login novo): Resend, Amazon SES ou SMTP próprio? Recomendação: Resend (grátis no início); em dev, Mailpit no compose.
4. **CAPTCHA** no login/recuperação após falhas: Turnstile? Recomendação: Turnstile, só depois da 3ª falha.
5. **Alerta de login novo** por e-mail (dispositivo/IP novo) e de fator MFA cadastrado/removido: ligar já? Recomendação: sim.
6. **ADMIN_EMPRESA vê auditoria da própria empresa?** Recomendação: sim, via `auditoria/visualizar`.
7. **Quantos códigos de recuperação?** Recomendação: 10, de 10 caracteres, gerar de novo invalida os anteriores.
