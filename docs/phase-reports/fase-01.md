# Relatório de fase · Fase 01 · Arquitetura, segurança e controle de acessos

- **Status:** Aguardando aceite
- **Período:** 2026-11-02 (spec aprovada) a 2026-11-04 (fechamento)
- **Commit de referência:** `c70771e` (PR 11: remoção do `supabase/`, testes de fechamento e este relatório). CI desse commit: [run 41813636431](https://github.com/ValeAdriano/Licita-Board/actions/runs/41813636431), 6 jobs verdes (guardas com Semgrep e Gitleaks, web, api + banco, worker, backup, `ci-ok`).
- **Resumo em uma linha:** a fase **não está integralmente concluída**: sete dos oito critérios de aceite estão COMPROVADOS por teste; o CA-6 (restauração de backup) está PARCIAL, porque a restauração foi provada em disco local e no CI, mas nunca em servidor real com bucket S3 externo. Além disso há lacunas de operação (TLS e cabeçalhos no Caddy, primeiro SUPERADMIN, três telas) listadas abaixo.

Evidências em [`docs/phase-reports/evidencias/fase-01/`](evidencias/fase-01/): `testes-2026-11-04.txt` (execução local das suítes) e `restauracao-2026-11-03.txt` (backup e restauração).

## 1. Funcionalidades

### Testado e aprovado

| Requisito | Evidência (teste / CI) |
| --- | --- |
| RF-01.1 Schemas, UUID v7, `updated_at` automático | pgTAP `001_guarda_global` (19), `010_cnpj_uuid` (9), `020` (`updated_at` avança sozinho no UPDATE); `db/scripts/test-local.sh` aplica as 14 migrations, desfaz todas (`-- migrate:down`) e aplica de novo |
| RF-01.2 Auditoria insert-only (quem, o quê, quando, IP, empresa, antes/depois) | pgTAP `030_audit_log` (16): INSERT/UPDATE auditados com autor, IP e user agent; nem o dono altera, apaga ou trunca; vale também em modo replica; dado pessoal redigido |
| RF-01.3 Empresa com CNPJ validado (numérico e alfanumérico) | pgTAP `010_cnpj_uuid` (exemplo oficial alfanumérico); e2e `acesso`: CNPJ inválido responde 400 sem nome de constraint |
| RF-01.4 Perfis SUPERADMIN, ADMIN_EMPRESA, OPERADOR, JURÍDICO, CLIENTE | pgTAP `020_core_isolamento` (56): um bloco por perfil; CLIENTE só recebe `visualizar` e sem MFA não ganha escrita; e2e `acesso`: SUPERADMIN cria empresa, os demais recebem 403. Registro de OAB: e2e `acesso` "persistência" (grava e relê) |
| RF-01.5 Matriz empresa × módulo × 12 ações, negar por padrão | pgTAP `020`, `110_salvar_vinculo`; e2e `acesso` (matriz exige step-up do escopo certo); vitest `matriz.test.ts` |
| RF-01.6 Isolamento em duas camadas, A x B por tabela e por endpoint | pgTAP `020`; e2e `rotas` (toda rota com `:empresa` confere a permissão no guard) e `acesso` (A x B); `scripts/check_isolation_coverage.py` no CI (hoje 0 tabelas em `priv`, ver seção 7) |
| RF-01.7 Senha Argon2id, mínimo 12, senha vazada bloqueada | vitest `senha.spec.ts` (hash `$argon2id$v=19$m=19456,t=2,p=1`, mínimo 12, máximo 128); `protecoes.spec.ts` (HIBP só envia 5 caracteres; lista local pega senhas óbvias); e2e `recuperacao` (senha óbvia recusada ao redefinir e ao trocar) |
| RF-01.8 Bloqueio progressivo por usuário e IP | e2e `auth` (10 falhas bloqueiam e rajada paralela não fura; 11º pedido do IP recebe 429); pgTAP `040_sessoes_login`; CAPTCHA a partir da 3ª falha: e2e `recuperacao` |
| RF-01.9 Sessão em cookie, 30 min de inatividade, 12 h absoluta, revogação de todas | e2e `auth` (cookie `__Host-` HttpOnly Secure SameSite=Strict, `no-store`; sair de todas as sessões mantendo ou não a atual, sem tocar a de outro usuário; consulta de fundo não renova); pgTAP `002_contexto` (sessão parada há 30 min e além de 12 h é recusada) |
| RF-01.10 MFA TOTP para perfis internos; códigos de recuperação de uso único | e2e `mfa` (11) e `rotas` (perfil interno em aal1 só passa na lista fechada); pgTAP `050_mfa` (vetores da RFC 6238), `060_mfa_endurecimento` |
| RF-01.11 Recuperação por token de uso único, 30 min, sem revelar o e-mail | e2e `recuperacao`: mesma resposta com e sem conta; link redefine uma vez e encerra sessões; token inventado e token vencido (expira_em no passado) recusados com a mesma mensagem |
| RF-01.12 Step-up em operações críticas | pgTAP `070_step_up` (36); e2e `acesso` (sem step-up do escopo certo, 403) |
| RF-01.13 Exclusão definitiva só SUPERADMIN, com dupla aprovação | pgTAP `080_exclusao_dupla_aprovacao` (30); e2e `acesso` (só outro SUPERADMIN decide) |
| RF-01.14 Shell, notificações, conta, seletor de empresa | vitest do front (70 testes em 9 arquivos: `contexto`, `equipe`, `Alertas`, `matriz`, `App`...); pgTAP `090_notificacoes` (27); e2e `acesso` (notificações, convite, `GET /modulos`) |
| RF-01.15 Push: inscrição Web Push e envio pelo worker | pgTAP `140_dispositivos_push` (53); e2e `push` (8, A x B incluso); worker `test_push.py` e `test_fila.py` (envio simulado, revogação em 404/410, falha transitória não conta) |
| RF-01.16 Backup externo + restauração testada | **parcial**, ver CA-6 |

### Implementado sem teste automatizado

| Requisito | Por que sem teste | Plano |
| --- | --- | --- |
| Web Push ponta a ponta (inscrição real e entrega pelo FCM, Mozilla ou Apple) | O navegador do painel de desenvolvimento só mostra o estado "bloqueadas"; a entrega real exige chaves VAPID de produção | Validar em Chrome, Firefox e iPhone com o PWA instalado, no primeiro deploy |
| PWA instalável e service worker (cache, atualização) | Só o build (`vite build`, 22 entradas pré-cacheadas) é verificado | Teste manual no deploy; Playwright quando houver ambiente |
| Layout responsivo, contraste ≥ 4.5:1 e alvos ≥ 44 px | Escolhidos nos tokens de design e conferidos à mão no navegador do painel; sem verificação automática nem captura guardada | Playwright em viewport mobile e desktop + verificação de contraste |
| Atraso progressivo do login a partir da 3ª falha (RF-01.8) | O código existe (`auth.service.ts`); os testes cobrem o CAPTCHA na 3ª falha e o bloqueio de 15 min na 10ª, não o atraso | Teste com relógio controlado no PR 12 |
| Envio de e-mail real (SMTP/Resend), Turnstile e HIBP reais | Os testes usam servidor, resposta e endpoint simulados; nenhum teste chama a rede | Conferir no deploy com Resend, chaves Turnstile e HIBP reais |
| `docker compose up` completo (API, worker, Mailpit, Postgres juntos) | Não há Docker nesta máquina; o CI só **constrói** as imagens da API e do banco e roda o pgTAP e o e2e contra o Postgres da imagem | Subir o compose na primeira máquina com Docker |
| Transporte S3 do backup, container de backup e Postgres 17 com pgBackRest do PGDG | O teste de restauração usa repositório em disco e Postgres 16; localmente com pgBackRest 2.60.0 (Homebrew), no CI com o pacote do apt | MinIO no CI e ensaio real no servidor (CA-6) |
| Cobertura de código da API e do front | Só o worker mede cobertura (83%); a meta de 80% em permissão está coberta por pgTAP e e2e, mas não por métrica | Ligar cobertura no CI da API e do front |
| Semgrep, Gitleaks, `npm audit`, `pip-audit` | Rodam só no CI (não estão instalados nesta máquina) | Resultado no run do CI citado no topo |

### Não implementado

| Requisito | Motivo | Vai para |
| --- | --- | --- |
| Telas de auditoria da empresa, de exclusão definitiva com dupla aprovação e de criação de empresa | A API e o banco estão prontos e testados; faltou o front | PR 12 (fechamento operacional) |
| Primeiro SUPERADMIN e seed fictício de desenvolvimento | Não há comando nem seed: hoje o primeiro usuário é criado por SQL como `vv_owner` | PR 12 |
| TLS, Caddy, CSP e cabeçalhos de segurança | O `infra/` só tem o backup; a política exata está documentada em `apps/web/AGENTS.md` | PR 12 (bloqueia o uso real) |
| Painel principal (dashboard) com dados | O Início mostra empresa, papel e os módulos liberados, todos marcados EM DESENVOLVIMENTO; os módulos de negócio nascem nas próximas fases | Fases 02 em diante |
| Passkeys (o Prompt aceita TOTP **ou** passkey) | TOTP atende o requisito | Depois do MVP |
| Criptografia em repouso do disco/volume do banco | Depende da VPS e do provedor; só o repositório de backup está cifrado | Fase 00 (deploy) |
| LGPD: contrato operador/controlador, retenção, atendimento ao titular, resposta a incidentes | Dependem do jurídico VV; o inventário técnico está atualizado em `docs/lgpd.md` | Jurídico, antes do 1º cliente real |
| Checklist ASVS L2 executado formalmente e pentest externo | O checklist foi atualizado para a stack atual (`docs/agents/checklists/asvs-l2-resumo.md`), mas não foi executado item a item em ambiente de homologação | Antes da primeira liberação em produção |
| Expurgo de `core.sessoes`, `core.tentativas_login`, `ops.jobs`, `core.notificacoes` | Falta decisão de prazo de retenção | Com o jurídico (LGPD) |
| Apps nativos iOS/Android | Adiados pela ADR-018 | Pós-MVP |
| Minuta do contrato operador/controlador (RF-01.17) | O inventário de dados pessoais foi entregue (`docs/lgpd.md`, rascunho); a minuta depende do jurídico VV | Jurídico, antes do 1º cliente real |
| SUPERADMIN "cadastra empresas clientes e administradores" (Prompt 1.2) | A API cria empresa (testado) e convida administrador (testado); falta a tela de criar empresa e o fluxo guiado de "primeiro administrador" | PR 12 |
| Criptografia em nível de campo com KMS, cofre de certificados A1 e senhas de portal, validação de tipo de arquivo, antivírus, URL assinada, SHA-256 (Prompt 1.4, Dados sensíveis e Arquivos) | Não há dado sensível de negócio nem arquivo ainda; a spec da Fase 01 não os inclui | Fases 02 e 03 |
| "Baixar" recurso de outra empresa (Prompt 1.4, teste A x B) | Não existe download ainda | Fase 03 |

### Limitações conhecidas

- A lista local de senhas comuns é curta (a HIBP cobre o resto, mas o fallback sem rede é fraco).
- O front não tem teste em navegador real (Playwright): CA-5 foi provado na API, não recarregando a página.
- Várias abas abertas não se sincronizam entre si (sem `BroadcastChannel`).
- O Turnstile roda no mesmo contexto da página, sem iframe isolado.
- `PUT /vinculos` não confere a versão do vínculo (T2.6): duas edições simultâneas, a última vence.
- Se só o `PUT` falha depois de um step-up aceito, o token é consumido e o usuário precisa refazer o código.
- Não há mensagem própria para "teto de concessão"; aparece o erro genérico de permissão.
- A regra 18 (migration aplicada é imutável) é imposta pelo hook do Claude Code e pelo passo do CI "Migrations já no main não foram alteradas", que só roda em `pull_request`; com push direto no `main` o CI não a confere.
- Sem limite global de e-mails por hora nem alerta de job que falhou (T7.2).

## 2. Arquivos e componentes criados

De `e72b749` (spec aprovada) a `ad71bef`, sem lockfiles: 252 arquivos, 14.091 linhas somadas e 3.754 removidas (a remoção inclui o front do Supabase e o app Expo, substituídos).

| Pasta | Conteúdo | Arquivos / linhas |
| --- | --- | --- |
| `db/` | 14 migrations, helpers e 17 arquivos pgTAP, scripts de teste e KEK, Dockerfile com pgTAP e pgBackRest | 35 / +5.584 |
| `apps/api/` | NestJS: auth, MFA, acesso, push, saúde; 7 arquivos e2e e 5 unitários | 33 / +2.654 |
| `apps/web/` | React 19 + Vite PWA: telas, cliente da API, design system, push | 114 / +3.889 (-3.195 do front antigo) |
| `apps/worker/` | Fila `ops.jobs`, e-mail, Web Push | 12 / +870 |
| `infra/backup/` | pgBackRest, timers systemd, runbook, teste de restauração | 9 / +416 |
| `docs/` | ADR-018, spec, threat model, guias para agentes | 21 / +501 |

PR 11 remove o `supabase/` (27 arquivos, 3.771 linhas; o estado anterior fica na tag `revisao-1-supabase`), `scripts/db-local/` (rodava as migrations do Supabase) e o job "Banco (pgTAP)" do CI, que testava só o `supabase/`.

## 3. Alterações no banco

| Migration | Tabelas / funções | Teste A x B / pgTAP |
| --- | --- | --- |
| `20261103010000_fundacao` | Schemas, papéis `vv_owner`/`vv_api`/`vv_worker`, `uuid_v7`, contexto | `000_helpers`, `001_guarda_global` |
| `20261103020000_auditoria` | `audit.audit_log`, `audit.registrar()` | `030_audit_log` |
| `20261103020100_core_acesso` | `empresas`, `modulos`, `usuarios`, `vinculos`, `permissoes`, `has_permission`, `cnpj_valido` | `010_cnpj_uuid`, `020_core_isolamento` |
| `20261103030000_sessoes` | `sessoes`, `tentativas_login`, `tokens_recuperacao`, `chaves_mestras`; login em duas etapas; contexto por token | `002_contexto`, `040_sessoes_login` |
| `20261103030100_mfa` | `fatores_mfa`, `codigos_recuperacao`; TOTP conferido no banco | `050_mfa` |
| `20261103040000_mfa_endurecimento` | Fator pendente preso à sessão, bloqueio duro, reset | `060_mfa_endurecimento` |
| `20261103050000_step_up_permissoes` | `step_up_tokens`; vínculo e permissão só por função; teto de concessão | `070_step_up` |
| `20261103050100_exclusao_dupla_aprovacao` | `aprovacoes_exclusao` | `080_exclusao_dupla_aprovacao` |
| `20261103050200_notificacoes` | `notificacoes` | `090_notificacoes` |
| `20261103050300_convites` | `convites`, `salvar_vinculo` | `100_convites`, `110_salvar_vinculo` |
| `20261103060000_fila_jobs` | `ops.jobs`, recuperação de senha, alertas de segurança | `120_fila_recuperacao` |
| `20261103070000_contexto_fundo` | `definir_contexto(token, renovar)` | `130_contexto_fundo` |
| `20261103080000_convites_recebidos_detalhe` | CNPJ e autor no convite recebido | `100_convites` |
| `20261103090000_dispositivos_push` | `dispositivos_push`, gatilho de `push_notificacao` | `140_dispositivos_push` |

Nenhuma tabela de `priv` existe ainda (começam na Fase 02); por isso `db/tests/isolamento/` só tem o modelo. O isolamento A x B das tabelas de `core` está em `020_core_isolamento` e nos e2e da API.

## 4. Integrações operacionais

| Integração | Estado | Evidência |
| --- | --- | --- |
| CI (GitHub Actions): guardas, web, api, worker, backup, `ci-ok` | Verde no `c70771e` | [run 41813636431](https://github.com/ValeAdriano/Licita-Board/actions/runs/41813636431) |
| E-mail (Mailpit em dev; Resend em produção) | Dev: worker pronto; produção **não configurada** | `test_email.py` (montagem do e-mail) e `test_fila.py` (falha de SMTP simulada); o envio SMTP real não é exercitado em teste |
| CAPTCHA Turnstile | Implementado; chaves de produção **não criadas** | e2e `recuperacao` (com Turnstile simulado) |
| HIBP | Implementado (k-anonymity); chamada real **não exercida** | `protecoes.spec.ts` |
| Web Push (VAPID) | Implementado; entrega real **não validada** | ver "sem teste" |
| Backup pgBackRest | Restauração provada em disco; S3 **não configurado** | `restauracao-2026-11-03.txt`; job `backup` do CI |
| Healthchecks (alerta de backup) | Scripts prontos; serviço **não criado** | `infra/backup/README.md` |
| Servidor (VPS), domínio, Caddy, Sentry | **Não existem** | Fase 00 pendente |

## 5. Testes e resultados

Execução local de 2026-11-04 em `evidencias/fase-01/testes-2026-11-04.txt`.

| Suíte | Comando | Resultado |
| --- | --- | --- |
| Banco | `db/scripts/test-local.sh` | 14 migrations: up, rollback de todas, up; 17 arquivos pgTAP, 428 asserções, todos ok |
| Isolamento | `python3 scripts/check_isolation_coverage.py` | OK (0 tabelas em `priv`) |
| API unitário | `npm test --prefix apps/api` | 24 testes em 5 arquivos, passam |
| API e2e (Postgres real, A x B) | `npm run test:e2e --prefix apps/api` | 61 testes em 7 arquivos, passam |
| Web | `npm test --prefix apps/web` | 70 testes em 9 arquivos, passam; lint, typecheck e build do PWA ok |
| Worker | `uv run pytest --cov` | 42 testes passam; cobertura 83% |
| Guardas | `python3 -m unittest discover -s scripts/tests` e `.claude/hooks/tests` | 7 e 11 testes, passam |
| SAST / segredos | Semgrep, Gitleaks (só no CI) | Verde no run 41813636431 (`c70771e`) |
| Backup | `infra/backup/testar-restauracao.sh` (CI, job `backup`) | Verde: full + diferencial + WAL, cifra provada com controle, desastre, senha errada recusada, PITR |

## 6. Critérios de aceite

| # | Critério | Status | Evidência |
| --- | --- | --- | --- |
| CA-1 | SUPERADMIN e ADMIN_EMPRESA acessam só o que administram | COMPROVADO (interpretação do SUPERADMIN na nota abaixo) | pgTAP `020` ("A lista só a própria empresa", "A não lê vínculos/permissões/auditoria de B", "ADMIN_EMPRESA não troca o CNPJ nem arquiva a empresa"); e2e `acesso` ("rotas da empresa B respondem 404 para A", inclusive id inexistente e id que não é UUID) e `rotas` |
| CA-2 | OPERADOR e JURÍDICO acessam só empresas autorizadas | COMPROVADO | pgTAP `020`: OPERADOR e JURÍDICO veem só a empresa do vínculo, não leem vínculos de B, sem permissão em B, sem auditoria sem `auditoria/visualizar`, revogação vale na consulta seguinte. e2e `acesso`: OPERADOR com vínculos em A (só visualizar) e em B (visualizar e editar) edita B, não edita A e não vê usuários de A. O papel JURÍDICO não tem e2e próprio (usa o mesmo mecanismo de permissão do OPERADOR; coberto no pgTAP) |
| CA-3 | CLIENTE não acessa outra empresa nem alterando a requisição | COMPROVADO | e2e `acesso` com CLIENTE como atacante (404 em empresa, usuários e auditoria de B; lista só a própria; 403 ao criar empresa e ao decidir exclusão; vê zero pedidos de exclusão) e A x B com ADMIN_EMPRESA; e2e `rotas` (toda rota com `:empresa` confere a permissão; toda rota não pública responde 401 sem sessão); pgTAP `020` (CLIENTE lê só a própria empresa, não altera, sem MFA não ganha escrita). Os endpoints `POST /auth/mfa/resetar/:usuario` e `POST /me/convites/:id/aceitar` têm a recusa a quem não pode no pgTAP (`060_mfa_endurecimento`, `100_convites`), não no e2e |
| CA-4 | Acessos e alterações relevantes auditáveis | COMPROVADO | pgTAP `030_audit_log`; e2e `acesso` "persistência": as duas criações de sessão (INSERT) e a saída (UPDATE) aparecem em `audit.audit_log`. Leitura de dados não é auditada; não há tela de auditoria |
| CA-5 | Dados persistem após sair e entrar | COMPROVADO (limite: sem teste em navegador) | e2e `acesso` "persistência": nome, telefone e OAB gravados, logout (a sessão antiga recebe 401), novo login mostra os mesmos dados, o vínculo e o acesso à empresa. Não houve teste recarregando a página no navegador |
| CA-6 | Restauração de backup testada | PARCIAL | `restauracao-2026-11-03.txt` e job `backup` do CI: full + diferencial + WAL restaurados, cifra provada, senha errada recusada, PITR até o alvo. **Falta:** ensaio real em servidor com bucket S3 externo, RTO medido (meta ≤ 4 h) e relatório do ensaio |
| CA-7 | Ataques de auth barrados | COMPROVADO | e2e `auth` (força bruta, rajada paralela, limite por IP, fixação de sessão, login CSRF e CSRF com cookie, enumeração: senha errada, e-mail inexistente e conta bloqueada respondem igual); `mfa` (código TOTP não serve duas vezes; 5 erros encerram a sessão); `recuperacao` (resposta igual, token de uso único e vencido recusados); pgTAP `002_contexto` (sessão revogada, parada ou vencida) |
| CA-8 | Contexto forjado não vale | COMPROVADO | pgTAP `002_contexto` (17): `app.usuario_id` e `app.aal` forjados são ignorados, hash de token inventado não vale, sessão revogada perde o contexto na consulta seguinte, `vv_api` não lê `core.sessoes`, o token cru não fica no contexto, `vv_worker` não define contexto de usuário |

**Nota CA-1.** O SUPERADMIN é a equipe da plataforma (RF-01.4) e administra todas as empresas: o teste "SUPERADMIN com MFA lê todas as empresas" prova que ele as vê só com `aal2`. Interpretei "só o que administram" assim. Se o Adriano entende que o SUPERADMIN também deve ficar restrito a empresas atribuídas, isso é uma regra nova que precisa de spec.

**Critérios do Prompt Mestre 1.4 fora dos CA que continuam abertos:** TLS 1.2+ (Caddy ausente), criptografia em repouso do volume, backup em conta/região distinta (configurável, não provado), retenção mínima de 30 dias (configurada: 5 fulls semanais, cerca de 35 dias; não provada em operação), RPO ≤ 24 h (WAL arquivado a cada 60 s no teste; não medido em produção), "backup diário" (hoje full semanal + diferencial diário + WAL contínuo), RTO ≤ 4 h (não medido), teste trimestral de restauração (o primeiro ainda não ocorreu), ASVS L2 e pentest externo, e o pacote de LGPD (1.5) além do inventário.

## 7. Erros conhecidos

- Nenhum teste falhando. Os itens de "Limitações conhecidas" (seção 1) são comportamentos aceitos ou pendentes, não regressões.
- Nada em `priv` ainda: a verificação "toda tabela de `priv` tem teste A x B" passa por vazio. Ela só passa a valer na Fase 02.
- Migrations antigas citam em comentário o caminho `supabase/migrations/...` do port; os arquivos são imutáveis e o conteúdo antigo está na tag `revisao-1-supabase`.
- Não há seed nem comando para criar o primeiro usuário (ergonomia, não segurança): quem sobe o ambiente hoje precisa de SQL.

## 8. Dependências pendentes

**Do Adriano / operação:**

- Bucket S3 em outro provedor (versionamento e object lock), duas credenciais (gravar e só ler), cofre para a senha de cifra do backup e para a `VV_KEK`.
- VPS, domínio, Resend, Turnstile de produção, Healthchecks, Sentry.
- Instalar o Docker para subir o compose.
- Decidir o destino do projeto Supabase `gqrilopolbanlrdyrrsd` (pausar ou excluir). Nenhum agente deve mexer nele.
- Confirmar a interpretação do CA-1 (nota acima).
- Ícones definitivos do PWA.

**Do jurídico VV:** bases legais e prazos de retenção, contrato operador/controlador, atendimento a titulares, resposta a incidentes, contrato de tratamento com os provedores.

## 9. Riscos novos e atualização do modelo de ameaças

`docs/threat-model.md` foi atualizado a cada PR da fase com os controles e riscos novos: T1.1, T2.1 a T2.7, T3.1c e T3.1d, T4.b, T5.1b a T5.33, T7.1 a T7.3 e T8.1 a T8.14 (backup e restauração). No PR 11:

- As ameaças T5.2 a T5.5 da revisão 1 (Supabase Auth, JWT, Vercel) citavam testes que já não existem; foram trocadas por uma nota de histórico que aponta para os controles equivalentes da stack atual (T5.17 a T5.26).
- Os caminhos de T1 passaram a apontar para `db/tests/001_guarda_global.test.sql` e `db/tests/isolamento/`.
- Nenhuma ameaça nova surgiu com a remoção do `supabase/`.

Riscos que continuam abertos e dependem de deploy: CSP e cabeçalhos no Caddy (T5.18 e T5.21 a T5.26), chaves VAPID e `VV_KEK` em cofre, bucket de backup com credenciais de escrita separadas da de leitura.

## 10. Próxima fase recomendada

1. **Aceitar (ou devolver) a Fase 01** com a nota do CA-1 e o CA-6 parcial.
2. **PR 12, fechamento operacional da Fase 01** (pequeno, em paralelo): comando para criar o primeiro SUPERADMIN e seed fictício de dev; Caddy com TLS, CSP e cabeçalhos; telas de auditoria, exclusão com dupla aprovação e criação de empresa. Sem isso o sistema não é utilizável por uma pessoa real.
3. **Spec da Fase 02** (cadastro multiempresa, representantes e produtos): sem spec `Aprovada`, a única tarefa possível é escrevê-la. É a fase que cria as primeiras tabelas de `priv` e portanto ativa de verdade o teste de isolamento A x B por tabela.
4. Em paralelo e sem código: o Adriano cria o bucket, o cofre e a VPS, para o primeiro ensaio real de restauração (que fecha o CA-6), e o jurídico VV começa o pacote de LGPD.
