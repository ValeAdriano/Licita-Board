# Spec · Fase 01 · Arquitetura, segurança e controle de acessos

- **Status:** Rascunho — a base de banco (PR 1) segue o modelo do plano aprovado; telas e regras abertas aguardam aprovação
- **Onda:** 1 — Fundação
- **Autor:** Claude Code · **Aprovação:** pendente (Adriano Vale)
- **Validação jurídica:** LGPD (contrato operador/controlador) — pendente
- **Fontes:** Prompt Mestre Fase 01 (1.1–1.5); Plano, Fase 01 e "Modelo de dados núcleo e RLS"; ADR-002, ADR-003, ADR-009, ADR-010

## 1. Escopo

**Entra:** schemas e helpers do banco, auditoria imutável, empresas (campos mínimos), usuários, vínculos, permissões, `has_permission()`, MFA no RLS, step-up, login/recuperação/MFA/sessões no front, shell do app, matriz de permissões, exclusão definitiva com dupla aprovação, PWA base, inventário LGPD, backup externo com restauração testada.

**Não entra:** campos completos de empresa, dados bancários/PIX, representantes (Fase 02); documentos e storage (Fase 03); qualquer tabela de `priv` (a partir da Fase 02).

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-01.1 | Schemas `core`, `pub`, `priv`, `ops`, `audit`; UUID v7; `updated_at` automático | Plano; Prompt 1.4 (UUID) |
| RF-01.2 | `audit.audit_log` insert-only: quem, o quê, quando, IP, empresa, antes/depois; ninguém altera ou apaga | Prompt 1.4 Auditoria |
| RF-01.3 | `core.empresas` com CNPJ validado por dígito verificador (numérico e alfanumérico) | Prompt 2.1, 1.4 |
| RF-01.4 | Perfis SUPERADMIN, ADMIN_EMPRESA, OPERADOR, JURÍDICO, CLIENTE | Prompt 1.2 |
| RF-01.5 | Matriz por empresa × módulo × 12 ações, negar por padrão | Prompt 1.3 |
| RF-01.6 | Isolamento em duas camadas; teste A x B | Prompt 1.4 |
| RF-01.7 | MFA obrigatório para perfis internos (exigido no RLS) | Prompt 1.4; ADR-002 |
| RF-01.8 | Step-up MFA (token de 5 min) para operações críticas | Prompt 1.4 Operações críticas |
| RF-01.9 | Exclusão definitiva só SUPERADMIN, com dupla aprovação | Prompt 1.3 |
| RF-01.10 | Login, recuperação neutra, MFA, sessões ativas, sair de todos | Prompt 1.1, 1.4 |
| RF-01.11 | Shell: menu lateral (desktop) / bottom nav (mobile), notificações, configurações, seletor de empresa | Prompt 1.1; Plano |
| RF-01.12 | PWA base: manifest, ícones, service worker, tela offline | ADR-010 |
| RF-01.13 | Backup semanal externo + restauração testada | Prompt 1.4 Backup |
| RF-01.14 | Inventário LGPD e minuta operador/controlador | Prompt 1.5 |

## 3. Modelo de dados (PR 1 · implementado)

### Convenções

- `core.uuid_v7()` gera os IDs (Postgres 17 não tem `uuidv7()` nativo).
- `core.set_updated_at()` em toda tabela com `updated_at`.
- `audit.registrar()` em toda tabela de `core` e `priv`. O argumento opcional diz qual coluna é a empresa (padrão `empresa_id`; `id` em `core.empresas`).

### `core.empresas` (mínimo; Fase 02 completa)

| Coluna | Tipo | Regra |
| --- | --- | --- |
| id | uuid | PK, v7 |
| razao_social | text | não nulo, 2–200 caracteres |
| nome_fantasia | text | opcional |
| cnpj | text | 14 caracteres, maiúsculo, sem máscara, único, `core.cnpj_valido()`; **não editável pela API** |
| ativo | boolean | padrão true |
| created_at, updated_at, created_by, deleted_at | | padrão |

### `core.usuarios` (perfil 1:1 de `auth.users`, criado por trigger)

| Coluna | Tipo | Regra |
| --- | --- | --- |
| id | uuid | PK = `auth.users.id` |
| nome, email, telefone | text | |
| oab | text | opcional (perfil JURÍDICO) |
| superadmin | boolean | padrão false; **não editável** pelo próprio usuário (grant por coluna) |
| ativo | boolean | padrão true |

### `core.vinculos` (usuário × empresa × papel)

`usuario_id`, `empresa_id`, `papel` ∈ {ADMIN_EMPRESA, OPERADOR, JURIDICO, CLIENTE}, `ativo`, colunas padrão. Único por (usuário, empresa) enquanto não excluído. `usuario_id` e `empresa_id` são imutáveis pela API. `usuario_id` é RESTRICT: usuário nunca é apagado, só desativado/anonimizado (RPC futura, LGPD).

### `core.modulos` e `core.permissoes`

- `core.modulos(slug, nome, ordem)`: catálogo de módulos (empresas, usuarios, permissoes, auditoria, representantes, produtos, documentos, agenda, editais, analises, precos, propostas, juridico, contratos, financeiro, relatorios, configuracoes).
- `core.permissoes(vinculo_id, empresa_id, modulo, acao)`: uma linha por permissão concedida. FK composta `(vinculo_id, empresa_id)` garante que a empresa é a do vínculo. `acao` ∈ {visualizar, cadastrar, editar, arquivar, substituir_arquivos, gerar_documentos, ver_custos_margens, elaborar_peca, aprovar_peca, aprovar, exportar, administrar_permissoes}. Sem linha = negado.

### Funções de autorização

| Função | Regra |
| --- | --- |
| `core.mfa_ok()` | `auth.jwt()->>'aal' = 'aal2'` |
| `core.is_superadmin()` | usuário ativo com `superadmin = true` **e** MFA |
| `core.has_permission(empresa, modulo, acao)` | vínculo ativo + usuário ativo + empresa ativa + permissão na tabela + MFA (CLIENTE dispensa MFA **só para visualizar**), ou SUPERADMIN |
| `core.cnpj_valido(text)` | 12 caracteres `[0-9A-Z]` + 2 dígitos; DV módulo 11 com valor do caractere = ASCII − 48 (regra da Receita para o CNPJ alfanumérico, que também vale para o numérico); rejeita sequência repetida |

### RLS

| Tabela | select | insert | update | delete |
| --- | --- | --- | --- | --- |
| core.empresas | `has_permission(id,'empresas','visualizar')` | SUPERADMIN | `has_permission(id,'empresas','editar')`, só `razao_social`/`nome_fantasia` | ninguém (soft delete via RPC) |
| core.usuarios | o próprio, SUPERADMIN, ou quem tem `usuarios/visualizar` numa empresa em comum | ninguém (trigger) | o próprio (só nome, telefone, oab) ou SUPERADMIN | ninguém |
| core.vinculos | o próprio ou `usuarios/visualizar` na empresa | SUPERADMIN (convite com aceite em PR futuro) | `permissoes/administrar_permissoes`, só `papel`/`ativo` | ninguém |
| core.permissoes | do próprio vínculo ou `permissoes/visualizar` na empresa | `permissoes/administrar_permissoes` | ninguém (revogar = delete) | `permissoes/administrar_permissoes` |
| core.modulos | autenticado | ninguém | ninguém | ninguém |
| audit.audit_log | SUPERADMIN ou `auditoria/visualizar` na empresa | ninguém (só trigger) | bloqueado por trigger, inclusive para o dono | bloqueado por trigger |

## 3.1 Step-up e dupla aprovação (PR 2 · implementado)

### `core.step_up_tokens`

`usuario_id`, `escopo` ∈ {alterar_permissoes, exclusao_definitiva, preco_abaixo_minimo, proposta_final, aprovar_peca}, `sessao_id`, `mfa_em` (instante da verificação TOTP), `expira_em` (5 min), `usado_em`, `usado_para_empresa_id`, `usado_para_alvo`. Sem acesso pela API: só as funções leem e escrevem. Uso auditado na empresa onde foi usado.

| Função | Regra |
| --- | --- |
| `core.iniciar_step_up(escopo)` | Exige `aal2`, verificação TOTP há ≤ 2 min (claim `amr`), sessão viva em `auth.sessions` e **fator TOTP verificado há ≥ 24 h** (sessão roubada que cadastra fator novo não consegue step-up). **Uma verificação MFA = um token** (`unique (sessao_id, mfa_em)`). |
| `core.consumir_step_up(token, escopo, empresa, alvo)` | Interna. Token do próprio usuário, mesmo escopo, mesma sessão e sessão ainda viva (logout invalida), não usado, não expirado. Registra empresa e alvo. |
| `core.criar_vinculo(usuario, empresa, papel, token)` | Só SUPERADMIN + step-up `alterar_permissoes`. |
| `core.atualizar_vinculo(vinculo, papel, ativo, token)` | `permissoes/administrar_permissoes` na empresa + step-up. |
| `core.definir_permissoes(vinculo, ['modulo:acao'], token)` | Idem; substitui o conjunto inteiro; lista nula é rejeitada. |

Toda alteração de vínculo/permissão trava os vínculos da empresa e exige que **reste ao menos um administrador de permissões ativo** (sem lockout). Insert/update/delete direto em `core.vinculos` e `core.permissoes` foram revogados do papel `authenticated`.

Só TOTP é aceito no step-up; habilitar WebAuthn/telefone exige nova migration (falha fechado). Um Custom Access Token Hook, se criado, precisa preservar `aal`, `amr` e `session_id`.

### `core.aprovacoes_exclusao`

Pedido de exclusão definitiva: `alvo_tabela` (lista fechada; hoje só `core.empresas`), `alvo_id`, `motivo` (10–2000 caracteres), `status` (pendente → executada/rejeitada/expirada), `solicitado_por`, `decidido_por` (≠ solicitante, também por constraint), `expira_em` (72 h), `resumo_alvo`. Registro imutável (trigger ALWAYS: sem DELETE/TRUNCATE; só sai de `pendente` uma vez, mudando apenas status e decisão). Nem o `service_role` apaga empresa fora do fluxo.

| Função | Regra |
| --- | --- |
| `core.solicitar_exclusao(tabela, id, motivo, token)` | SUPERADMIN + step-up `exclusao_definitiva`. Um pedido pendente por alvo. |
| `core.decidir_exclusao(pedido, aprovar, token)` | Outro SUPERADMIN + step-up. Recusa pedido expirado ou de solicitante que não é mais SUPERADMIN ativo. Aprovar executa a exclusão física (empresa + vínculos + permissões) na mesma transação. |

Teste-guarda: toda FK que apontar para `core.empresas` precisa ser tratada em `core.executar_exclusao`.

### Pendências registradas (revisão de 2026-11-01)

- Job no worker para limpar `step_up_tokens` expirados.
- `core.cancelar_exclusao` para o solicitante desistir do pedido.
- Desativação feita por SUPERADMIN hoje pode ser revertida pelo ADMIN_EMPRESA; avaliar `bloqueado_por_superadmin`.
- Guarda no deploy: falhar se o schema `tests` existir em produção.
- Ligar no Supabase as notificações de segurança de "fator MFA cadastrado/removido".

## 4. Regras de negócio

1. Negar por padrão: sem linha em `core.permissoes`, não há acesso. Não existe permissão implícita por papel no banco.
2. Revogação vale na próxima consulta (permissões não ficam no JWT).
3. Usuário ou vínculo inativo, ou empresa arquivada (`deleted_at`), não acessa nada.
4. Perfis internos sem `aal2` não acessam dado da empresa; CLIENTE pode usar `aal1` (ADR-002).
5. Auditoria ignora UPDATE que só muda `updated_at`.
6. CLIENTE só recebe a ação `visualizar` (trigger); mudar um vínculo para CLIENTE exige remover antes as permissões de escrita.
7. Dado pessoal de `core.usuarios` (nome, e-mail, telefone, OAB) é gravado como `[redigido]` na auditoria, que é imutável.
8. IP da auditoria é indício: `cf-connecting-ip` → `x-real-ip` → 1º `x-forwarded-for`.
9. Colunas sensíveis (CNPJ, `ativo`, `deleted_at`, `created_by`, `superadmin`, `usuario_id`, `empresa_id`) não são graváveis pela API: grants por coluna. Mudanças vão por RPC com step-up (PR 2).

## 5. Plano de PRs

1. ✅ `feat/fase-01-fundacao-banco`: RF-01.1 a RF-01.7 no banco + helpers de teste + pgTAP.
2. ✅ Step-up: `core.step_up_tokens`, RPCs de vínculo/permissão, dupla aprovação (`core.aprovacoes_exclusao`).
3. ✅ Auth no front: supabase-js, login, recuperação neutra, cadastro/verificação de MFA, sessões (`core.minhas_sessoes`), sair de todos, logout por inatividade (30 min), seed fictício para login local.
4. ✅ Shell: menu lateral (desktop) e barra inferior (celular), seletor de empresa ativa (lembrado por usuário), sino e tela de notificações (`core.notificacoes`), conta (nome/telefone, autenticadores, sessões), módulos futuros com tela EM DESENVOLVIMENTO, PWA (manifest, ícones provisórios, service worker só com o shell), aviso de sem conexão.
5. `feat/fase-01-matriz-permissoes`: tela da matriz + funções de concessão em lote.
6. `chore/fase-01-backup`: `pg_dump` criptografado semanal + relatório de restauração.
7. `docs/relatorio-fase-01`.

## 6. Critérios de aceite

| # | Critério | Como será comprovado |
| --- | --- | --- |
| CA-1 | SUPERADMIN e ADMIN_EMPRESA acessam só o que administram | pgTAP `core_isolamento` |
| CA-2 | OPERADOR e JURÍDICO acessam só empresas autorizadas | pgTAP `core_isolamento` |
| CA-3 | CLIENTE não acessa outra empresa nem alterando requisição | pgTAP + e2e (PR 3) |
| CA-4 | Acessos e alterações relevantes auditáveis | pgTAP `audit_log` |
| CA-5 | Dados persistem após sair e entrar | e2e (PR 3) |
| CA-6 | Restauração de backup testada | relatório (PR 6) |

## 3.2 Notificações (PR 4 · implementado)

`core.notificacoes`: `usuario_id`, `empresa_id` + `modulo` (juntos ou ambos nulos; cascade na exclusão da empresa), `tipo`, `titulo` (≤ 140), `corpo` (≤ 1000), `link`, `lida_em`, `created_at`.

- Criadas só pelo sistema (service role). O banco recusa notificação de empresa para destinatário sem vínculo ativo (segunda camada).
- Visível só ao destinatário **e** enquanto ele tiver `<modulo>/visualizar` na empresa (com MFA para perfil interno). Revogou o acesso, a notificação some.
- `link`: só caminho interno (sem `//`, `\`, `..`, `%`, domínio). O front confere de novo antes de virar link.
- `lida_em` é carimbado pelo servidor e não é desfeito. Ninguém reescreve o conteúdo enviado (nem o worker).
- Exceção consciente: sem colunas padrão e sem trigger de auditoria (justificativa no cabeçalho da migration).

## 6.1 Lacunas conhecidas do front de autenticação

- **Códigos de recuperação de uso único (Prompt 1.4):** o Supabase Auth não oferece. Alternativas: cadastrar um segundo autenticador como reserva, ou redefinição do MFA pelo SUPERADMIN via worker (Admin API) com verificação de identidade. Decisão pendente.
- Encerrar **uma** sessão específica não é possível pelo cliente; só "outras" ou "todas".
- Trocar a senha estando logado (com a senha atual) ainda não existe; `/redefinir-senha` só atende o link do e-mail.
- CAPTCHA (Turnstile) no login/recuperação e `connect-src` fixo no projeto ficam para quando o projeto de produção existir.
- `core.minhas_sessoes` esconde IP/dispositivo de perfil interno sem MFA (`core.perfil_interno()`).
- Bundle único de ~730 KB: dividir por rota (lazy) quando os módulos de negócio entrarem.
- Ícones e cores do PWA são provisórios até a identidade visual ser definida.
- Layout validado por testes de componente; falta checagem visual em 360 px no navegador (precisa do Supabase local para passar do login).
- Testes e2e (Playwright) contra o Supabase local ficam para quando houver Docker na máquina de desenvolvimento.

## 7. Perguntas abertas

0. **Convite de usuário** — hoje só SUPERADMIN cria vínculo (impede ADMIN de cooptar usuário de outra empresa). Recomendação: PR de convite por e-mail com aceite do convidado, via RPC.

1. **Permissões padrão por papel** — ao criar um vínculo, pré-preencher a matriz? Recomendação: sim, só como sugestão na tela (ADMIN_EMPRESA = tudo da empresa; OPERADOR = tudo menos permissões/auditoria/custos; JURÍDICO = visualizar + peças; CLIENTE = visualizar em documentos, agenda, editais, produtos), sempre editável e nunca implícita no banco.
2. **ADMIN_EMPRESA vê auditoria da própria empresa?** Recomendação: sim, via `auditoria/visualizar`.
3. **CAPTCHA no login** — Turnstile ou hCaptcha (os dois são suportados pelo Supabase Auth)? Recomendação: Turnstile.
