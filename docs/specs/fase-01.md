# Spec · Fase 01 · Arquitetura, segurança e controle de acessos

- **Status:** Aprovada (revisão 2: stack nova, auth própria) — 2026-11-02, com as recomendações da seção 9
- **Onda:** 1 — Fundação
- **Autor:** Claude Code · **Aprovação:** Adriano Vale, 2026-11-02
- **Validação jurídica:** LGPD (contrato operador/controlador) — pendente
- **Fontes:** Prompt Mestre Fase 01 (1.1–1.5); Plano (revisão 2), Fase 01 e "Modelo de dados núcleo e RLS"; ADR-012, ADR-013, ADR-015, ADR-016, ADR-017

> A revisão 1 desta fase foi implementada sobre o Supabase (`supabase/migrations`, front Vite) e foi removida no PR 11 (fica na tag `revisao-1-supabase`). As regras de negócio dela foram aprovadas na prática e **continuam valendo**; esta revisão muda só a infraestrutura: identidade e sessão passam a ser da API, e o contexto do usuário passa a ser conferido no banco.

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
| RF-01.9 | Sessão: cookie HttpOnly/Secure/SameSite (o front nunca vê o token); inatividade 30 min, absoluta 12 h; revogação de todas | Prompt 1.4; ADR-012, ADR-018 |
| RF-01.10 | MFA TOTP obrigatório para perfis internos; códigos de recuperação de uso único | Prompt 1.4 |
| RF-01.11 | Recuperação de senha por token de uso único, 30 min, sem revelar se o e-mail existe | Prompt 1.4 |
| RF-01.12 | Step-up (token de 5 min) em operações críticas | Prompt 1.4 |
| RF-01.13 | Exclusão definitiva só SUPERADMIN, com dupla aprovação | Prompt 1.3 |
| RF-01.14 | Shell: menu lateral (web largo) / abas (celular), notificações, conta, seletor de empresa | Prompt 1.1 |
| RF-01.15 | Push: inscrição Web Push (PWA) e envio pelo worker | ADR-018 |
| RF-01.16 | Backup externo + restauração testada | Prompt 1.4 Backup; ADR-015 |
| RF-01.17 | Inventário LGPD e minuta operador/controlador | Prompt 1.5 |

## 3. O que vem da revisão 1 (port)

As migrations `supabase/migrations/2026110112*–16*` e os testes `supabase/tests/*` (removidos no PR 11; tag `revisao-1-supabase`) foram portados para `db/` com estas trocas mecânicas. Regras, colunas, constraints e testes de negócio ficam iguais.

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

### Contexto validado no banco (ADR-013, Fase 01) — implementado no PR 2

- `core.definir_contexto(p_token text)` grava na transação só o SHA-256 do token; `usuario_atual`/`sessao_atual`/`aal_atual` buscam a sessão viva em `core.sessoes` a cada consulta (não revogada, absoluta 12 h, inatividade 30 min, usuário ativo). `ultimo_uso_em` é renovado no máximo uma vez por minuto, sem trava.
- Login em duas etapas: `core.preparar_login(email, ip)` (registra a tentativa como falha antes do Argon2, com advisory lock por e-mail; recusa conta bloqueada e IP acima de 10/min) e `core.concluir_login(tentativa, usuario, token, ...)` (só com a senha conferida). O bloqueio impede login novo, não derruba sessões abertas.
- MFA no banco: `cadastrar_totp`, `confirmar_totp`, `verificar_totp` recebem a KEK (conferida contra `core.chaves_mestras`, registrada por `db/scripts/registrar-kek.sh`); `gerar_codigos_recuperacao`/`usar_codigo_recuperacao` com SHA-256; `rotacionar_sessao` troca o token após trocar a senha ou elevar a aal2.
- Pendente para antes da primeira tabela de `priv` (desempenho, ADR-013): ler a sessão uma vez por consulta nas policies (`empresas_com_permissao`).

## 5. API (NestJS)

Todo endpoint autenticado passa por `SessaoGuard` (cookie `__Host-sessao` ou `Authorization: Bearer`) e declara `@Permissao(modulo, acao)` ou `@SoAutenticado()`. Endpoints que alteram estado exigem token CSRF no web. Respostas de erro não revelam se e-mail, empresa ou recurso existe (404 para recurso de outra empresa).

| Grupo | Endpoints |
| --- | --- |
| Auth público | `POST /auth/login`, `POST /auth/recuperar`, `POST /auth/redefinir` |
| Sessão | `POST /auth/mfa/verificar`, `POST /auth/mfa/recuperacao` (código de uso único), `POST /auth/logout`, `POST /auth/logout-todas`, `GET /auth/sessoes`, `DELETE /auth/sessoes/:id`, `POST /auth/senha` (trocar logado, exige a atual) |
| MFA | `POST /auth/mfa/cadastrar` (exige a senha atual; URI otpauth uma vez), `POST /auth/mfa/confirmar`, `POST /auth/mfa/verificar`, `POST /auth/mfa/recuperacao`, `POST /auth/mfa/codigos` (10 novos, uma vez, MFA recente), `POST /auth/mfa/resetar/:usuario` (SUPERADMIN) |
| Step-up | `POST /auth/mfa/step-up` (TOTP novo → token de 5 min do escopo, uso único, preso à sessão) |
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

1. ✅ `feat/fase-01-port-acesso`: empresas, modulos, vinculos, permissoes, has_permission, audit + pgTAP portados (contexto da Fase 00).
2. ✅ `feat/fase-01-identidade` (lembrar: `senha_hash` sem grant de SELECT para `vv_api` e redigida/fora da auditoria): colunas de identidade em usuarios, sessoes, fatores_mfa, codigos, tentativas, tokens; `definir_contexto(token)`, `criar_sessao`, `confirmar_mfa`; pgTAP.
3. ✅ `feat/fase-01-api-auth` (recuperação por e-mail, HIBP e CAPTCHA no 3b ✅: fila `ops.jobs`, worker enviando por SMTP/Mailpit, alertas de segurança; lista local de senhas comuns ainda curta): módulo auth (login, logout, sessões, recuperação, troca de senha), `SessaoGuard`, CSRF, `comContexto` (chama `definir_contexto` + `definir_requisicao`), e-mail via fila; e2e de ataque (força bruta, fixação de sessão, CSRF, enumeração de e-mail, `X-Forwarded-For` forjado pelo cliente: só vale o valor escrito pelo Caddy; IP inválido vira nulo, não derruba a requisição).
4. ✅ `feat/fase-01-api-mfa`: cadastro (com senha atual, pendente preso à sessão) e confirmação TOTP, verificação, códigos de recuperação, reset por SUPERADMIN, rotação do token na elevação; e2e (replay, força bruta, sessões). O step-up (fator ≥ 24 h) foi para o PR 5, junto do port de `step_up_tokens`.
5. ✅ `feat/fase-01-port-stepup-exclusao`: step_up_tokens, aprovacoes_exclusao, salvar_vinculo, convites, notificacoes no banco + endpoints + e2e A x B.
6. ✅ `feat/fase-01-app-auth`: login, MFA (verificar, cadastrar com exibição única dos códigos, código de recuperação), recuperação, sessão no SecureStore/cookie, logout por inatividade; testado no web contra a API local. Pendentes: Turnstile no nativo (WebView), QR code do TOTP, universal/app links para o link de redefinição abrir o app nativo.
7. ✅ `feat/fase-01-app-shell`: shell (abas no celular, menu lateral no web largo), seletor de empresa, notificações (polling de fundo que não renova a inatividade: `core.definir_contexto(token, renovar)` + `X-VV-Fundo`), conta (dados, senha, sessões, autenticador: ativar, trocar, gerar códigos); testado no web contra a API local.
8. ✅ `feat/fase-01-app-matriz`: aba Equipe (só com `usuarios:visualizar`): usuários da empresa, matriz módulo × 12 ações com sugestão por papel, convidar (7 dias), revogar, convites recebidos e aceitar; salvar e convidar passam por step-up `alterar_permissoes`; `GET /modulos` (catálogo). Pendente: tela de auditoria da empresa (`auditoria/visualizar`), exclusão definitiva com dupla aprovação (SUPERADMIN) e criação de empresa no app; testado no web contra a API local.
8b. ✅ `feat/fase-01-front-react` (ADR-018, pedido do Adriano em 2026-11-03): o app Expo (`apps/app`) foi trocado por um front React web em `apps/web` (Vite, PWA, React Router, design Apple em CSS com tokens: claro e escuro, alvos ≥ 44 px). Portados e testados no navegador contra a API local: login, MFA, recuperação e redefinição, shell (menu lateral no desktop, abas no celular), seletor de empresa, notificações, conta, equipe, matriz, convites e step-up. Sessão só em cookie HttpOnly (mesma origem, `/api`). O front da revisão 1 (Supabase) e o `apps/app` saíram do repositório. Pendentes: CSP e cabeçalhos no Caddy, ícones definitivos do PWA.
9. ✅ `feat/fase-01-push`: Web Push (VAPID): `core.dispositivos_push` (endpoint e chaves nunca lidos pela API; lista fechada de hosts de push contra SSRF; até 10 por usuário), `GET /push/chave`, `POST/DELETE /dispositivos-push` (+ consulta e revogar por endpoint), trigger que enfileira `push_notificacao` por notificação, worker enviando por `pywebpush` um aviso genérico (sem conteúdo), `public/push.js` no service worker (clique abre sempre `/notificacoes`), seção "Alertas neste dispositivo" na Conta e cancelamento da inscrição no logout (T5.26). Testado: pgTAP, e2e A x B, worker (unidade e integração com o banco) e vitest; no navegador do painel só o estado "bloqueadas" (a inscrição real depende de FCM/Mozilla/Apple, não validada). Pendentes: validar em Chrome, Firefox e iPhone instalado; chaves VAPID de produção; limpeza de dispositivos revogados antigos.
10. ✅ `chore/fase-01-backup`: pgBackRest (ADR-015): WAL contínuo (`archive_timeout=60`) + full semanal + diferencial diário cifrados (aes-256-cbc) para bucket S3 externo; `db/Dockerfile` com pgBackRest; `infra/backup/` (config, override do compose, agendamento systemd, Healthchecks, runbook de restauração); `infra/backup/testar-restauracao.sh` (full + diferencial + WAL, cifra provada com controles (marcador em claro num repositório sem cifra, ausente no cifrado, cabeçalho em todos os arquivos), desastre, senha errada recusada por decifragem, PITR conferido), rodando em todo PR no CI. Evidência parcial de CA-6 em `docs/phase-reports/evidencias/fase-01/`. Pendentes: ensaio real (VPS e bucket), transporte S3 (MinIO no CI), tempo de restauração (RTO).
11. ✅ `docs/relatorio-fase-01`: [`docs/phase-reports/fase-01.md`](../phase-reports/fase-01.md) com evidências reais (aguardando aceite do Adriano) e remoção de `supabase/` (tag `revisao-1-supabase` guarda o estado anterior), de `scripts/db-local/` e do job "Banco (pgTAP)" do CI. Testes novos no fechamento: e2e de persistência e de auditoria do acesso (CA-4, CA-5), de "sair de todas as sessões", de OPERADOR em duas empresas, de CLIENTE como atacante, de criação de empresa e de token de recuperação vencido; pgTAP dos papéis OPERADOR e JURÍDICO contra a empresa B e de `updated_at`; teste unitário do Argon2id. `docs/lgpd.md` e o checklist ASVS passaram para a stack atual.
12. ✅ `feat/fase-01-fechamento-operacional` (2026-11-04, proposto no relatório e pedido pelo Adriano em "siga desenvolvendo a fase 1"): `scripts/criar-usuario.mjs` (primeiro SUPERADMIN e, em dev, empresa fictícia; e2e), `infra/caddy/Caddyfile` e `testar-cabecalhos.sh` (job `caddy` do CI, Caddy real), telas de Plataforma (cadastrar empresa com CNPJ validado, abrir empresa para convidar o administrador, pedir e decidir exclusão definitiva com step-up) e de Auditoria da empresa; SUPERADMIN vê todas as empresas no seletor. Pendentes: serviço do Caddy no compose de produção (Fase 00), rotação do log, o ensaio real de restauração (CA-6; bucket, cofre e VPS dependem do Adriano).

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

## 9. Decisões (antes perguntas abertas; aprovadas em 2026-11-02 conforme a recomendação)

1. **TOTP conferido no banco:** segredo em `core.fatores_mfa` sem grant para `vv_api`, conferido por função `security definer` (HMAC via `pgcrypto`); o segredo é cifrado pela chave-mestra e decifrado só dentro da função. Um SQLi na API não eleva a própria sessão.
2. **Senha vazada:** HIBP por k-anonymity (só 5 caracteres do SHA-1 saem do servidor), com fallback para lista local das 100 mil senhas mais comuns.
3. **E-mail transacional:** Resend em produção; Mailpit no compose de dev. Envio sempre pelo worker (fila).
4. **CAPTCHA:** Turnstile, exigido a partir da 3ª falha de login ou recuperação.
5. **Alertas por e-mail:** login de dispositivo/IP novo e fator MFA cadastrado/removido.
6. **Auditoria:** ADMIN_EMPRESA vê a da própria empresa via `auditoria/visualizar`.
7. **Códigos de recuperação:** 10, de 20 caracteres base32 (~100 bits; reforço sobre os 10 da decisão original, decidido na revisão de segurança); gerar de novo invalida os anteriores e exige MFA nos últimos 5 min (não o step-up de fator ≥ 24 h, que impediria gerar códigos logo após o primeiro cadastro).
