# VV Licitações · Plano de Desenvolvimento

> Cópia de referência do plano. Decisões que mudarem aqui viram ADR em `docs/adr/`.

Nov 1, 2026 · @Adriano Vale · **Revisão 2 (2026-11-02): troca de stack.** Saem Supabase, Vite e Vercel. Entram Postgres próprio e Docker em todos os ambientes, API em Node (NestJS) e app em React Native (Expo para iOS, Android e Web). O worker Python continua. A revisão 1 fica no histórico do git; as ADRs 001, 002, 003, 004, 009 e 010 foram substituídas pelas ADRs 011 a 017.

## Visão geral e decisões

O VV Licitações será construído em 8 ondas. Teremos um app Expo (iOS, Android e Web, mobile-first) e uma API NestJS, que é a única porta de entrada dos dados. O banco é Postgres com RLS como segunda camada de isolamento, e um worker Python cuida de tudo que é pesado. Tudo roda em Docker, do notebook à produção. O plano segue o Prompt Mestre 2.1 fase a fase e registra cada desvio em ADR.

O MVP operacional (Ondas 1 e 2) substitui a planilha de agenda e o controle de certidões. A partir dele, cada onda entrega valor isolado: captura automática, análise técnica, propostas, jurídico e pós-licitação.

| Tema | Decisão | Impacto no plano |
| --- | --- | --- |
| Modelo de negócio | Híbrido: começa como consultoria VV e vira SaaS | Multi-tenant desde o dia 1; billing e onboarding self-service ficam para a Onda 8 |
| Equipe | Adriano solo + agentes de IA (Claude Code, Codex, Paseo) | Incrementos pequenos (< 500 linhas), spec por fase como prompt dos agentes, CI rígido como rede de segurança |
| Prazo | Sem data fixa | Estimativas em horas; ordem guiada por valor, não por calendário |
| Front | **Expo (React Native + TS) com Expo Router e react-native-web**: um código para iOS, Android e Web | Mobile-first de verdade; o web build substitui o PWA; lojas exigem contas Apple/Google |
| Backend | **API NestJS (Node 22 LTS, TS)** + **worker Python 3.12** | A API autentica, autoriza e expõe os endpoints; o worker consome a fila (PNCP, PDF/OCR, IA, DOCX, antivírus) e nunca expõe endpoint de negócio |
| Banco | **PostgreSQL 17 em Docker**, migrations em **SQL puro (dbmate)**, consultas com **Kysely** | O schema, a RLS e os testes pgTAP da Fase 01 são reaproveitados, trocando `auth.*` por contexto da API |
| Isolamento | Duas camadas: guard NestJS em todo endpoint **e** RLS no Postgres | Atende o Prompt 1.4 à risca; teste A x B por endpoint (API) e por tabela (pgTAP) |
| Auth | **Própria na API**: Argon2id, sessão opaca (cookie HttpOnly no web, token no SecureStore no nativo), TOTP, step-up | Fecha os dois desvios da revisão 1 (bcrypt 10 e JWT no client) |
| Fila e agenda | Tabela `ops.jobs` com `FOR UPDATE SKIP LOCKED` + agendador no worker | Sem Redis; Node e Python usam a mesma fila |
| Arquivos | S3 compatível: **MinIO** no Docker local, provedor S3 privado em produção | URL assinada curta gerada pela API depois da checagem de permissão |
| IA | Multi-provedor com token próprio (chave VV padrão, cliente pode trazer a sua) | LiteLLM no worker, chaves cifradas em campo (ADR-017) |
| Hospedagem | **Docker Compose numa VPS** (região São Paulo, provedor a escolher) + Caddy com TLS | Um servidor, um `compose.prod.yml`, deploy por pipeline |
| Ambientes | Dev em Docker Compose local + produção; homologação (outra stack Compose) antes do 1º cliente real | Mesmo artefato (imagem) em todos os ambientes |
| Validação jurídica | Jurídico interno da VV | Dono das tabelas de prazos, base legal e casos de teste |
| Volume ano 1 | Até 10 empresas, \~20 usuários | Um Postgres resolve; sem sharding, sem fila externa |
| Categoria inicial (Fase 06) | Veículos | Atributos, normalização de unidades e conjunto de teste começam por veículos |
| Notificações | In-app, push nativo (Expo Notifications), Web Push no web, e-mail, Google Calendar | WhatsApp fica para a Onda 8 |

Pendência que bloqueia a Onda 2: a planilha Excel atual de agenda. Sem ela, o modelo da agenda é desenhado pelo Prompt e ajustado depois.

## Arquitetura alvo

O app fala só com a API. A API autentica a sessão e confere a permissão no guard. Em seguida abre uma transação no Postgres com um papel sem bypass de RLS e o contexto do usuário (`app.usuario_id`, `app.sessao_id`, `app.aal`), então a RLS confere de novo. O worker Python consome a fila no mesmo Postgres, faz o trabalho pesado e grava o resultado. Ele valida `empresa_id` em todo job e não expõe nada ao app.

```text
[App Expo: iOS | Android | Web]
        | HTTPS (cookie HttpOnly no web, Bearer opaco no nativo)
        v
[Caddy (TLS)] --> [API NestJS] --guard + transação com contexto--> [PostgreSQL 17 + RLS]
                      |  URL assinada (60 s)                          ^      |
                      v                                               |      | ops.jobs (SKIP LOCKED)
                [S3: MinIO (dev) / S3 privado (prod)] <-------- [Worker Python 3.12]
                                                                       --> PNCP, Compras.gov, LLMs, ClamAV,
                                                                           LibreOffice, e-mail, push, Google Calendar
```

Tudo acima roda como serviço do Docker Compose (`postgres`, `minio`, `api`, `worker`, `clamav`, `caddy`, `mailpit` em dev). O app nativo roda no Expo Go ou em build de desenvolvimento e aponta para a API local. O web build é servido pelo Caddy.

## Desvios e adaptações frente ao Prompt Mestre

Com a API própria, quase todos os requisitos de segurança do Prompt passam a ser atendidos sem desvio. O que fica de adaptação está registrado em ADR.

| Requisito do Prompt | Como fica | Risco residual |
| --- | --- | --- |
| Next.js no front | Expo (React Native) com web build. Mesmo React + TS; ganha app nativo | Baixo. Desvio de framework registrado na ADR-011 |
| FastAPI no backend | NestJS na API; FastAPI só no worker (healthcheck interno) | Baixo. Desvio registrado na ADR-011 |
| Argon2id, senha ≥ 12, senha vazada | `argon2` (Argon2id) na API; HIBP por k-anonymity, com fallback de lista local | Baixo |
| Sessão em cookie HttpOnly, 30 min / 12 h | Web: cookie HttpOnly + Secure + SameSite=Strict + token CSRF. Nativo: token opaco no SecureStore (cookie não se aplica). Sessão em `core.sessoes` com inatividade e absoluta | Baixo |
| MFA por perfil, recuperação de uso único | TOTP (`otplib`) com segredo cifrado; códigos de recuperação com hash | Baixo |
| Bloqueio progressivo por usuário e IP | `core.tentativas_login` + rate limit (`@nestjs/throttler`) | Baixo |
| Reautenticação em operação crítica | Step-up TOTP gera token de 5 min, uso único, preso à sessão | Baixo |
| Isolamento em duas camadas | Guard NestJS + RLS. Teste A x B em todo endpoint e em toda tabela de `priv` | Baixo |
| Criptografia de campo + KMS | AES-256-GCM em envelope na API/worker; chave-mestra fora do banco (segredo do servidor, KMS quando houver) | Médio até existir KMS (ADR-017) |
| Auditoria imutável | `audit.audit_log` insert-only, triggers genéricos, papéis da aplicação sem UPDATE/DELETE | Baixo |
| Antivírus em upload | Upload vai para o prefixo `quarentena/`; o worker roda ClamAV e move | Baixo |
| URL assinada curta | API checa permissão, gera presigned URL de 60 s e audita | Baixo |
| Backup + restauração testada, RPO ≤ 24 h | WAL contínuo (wal-g ou pgBackRest) para bucket externo = PITR; teste de restauração trimestral | Baixo, com teste |
| 3 ambientes | Dev (Compose local) + produção; homologação antes do 1º cliente real | Desvio temporário (ADR-015) |
| Segredos em gerenciador | Segredos como arquivos do Docker (`secrets:`) no servidor; nunca no repositório nem em `.env` versionado | Médio até adotar um gerenciador (Infisical/Doppler) |

### ADRs desta revisão

| ADR | Decisão | Substitui |
| --- | --- | --- |
| ADR-011 | Stack: Docker Compose, Postgres 17, NestJS, Expo universal, worker Python, VPS | 001 |
| ADR-012 | Autenticação própria na API (Argon2id, sessão opaca, TOTP, step-up) | 002 |
| ADR-013 | Multi-tenant em duas camadas: guard NestJS + RLS por contexto de transação | 003 |
| ADR-014 | Fila `ops.jobs` (SKIP LOCKED) e agendador no worker | 004 |
| ADR-015 | Ambientes: Docker Compose em dev, homologação e produção | 009 |
| ADR-016 | App: Expo (Router, react-native-web), push nativo + Web Push | 010 |
| ADR-017 | Arquivos em S3 compatível (MinIO/S3) e criptografia de campo em envelope | trecho Vault/Storage de 005 e 007 |

ADR-005 (IA), ADR-006 (documentos), ADR-007 (certificados) e ADR-008 (busca) continuam valendo. Onde citam o Vault, passa a valer a ADR-017.

## Repositório, padrões e fluxo com agentes

O repositório é um monorepo só, e o banco é a fonte da verdade: migrations SQL geram os tipos TypeScript do Kysely (`kysely-codegen`), e os schemas Zod compartilhados validam a API e o app. Nenhum agente escreve schema fora de migration.

```text
licita-board/
├── apps/
│   ├── api/                 # NestJS + Kysely (Node 22)
│   │   ├── src/modules/     # 1 módulo por domínio (auth, empresas, documentos, agenda...)
│   │   ├── src/common/      # guards (sessão, permissão, step-up), contexto de banco, filtros
│   │   └── test/            # e2e com Postgres real; A x B por endpoint
│   ├── app/                 # Expo (React Native + TS), Expo Router, iOS/Android/Web
│   │   ├── app/             # rotas (Expo Router)
│   │   ├── src/features/    # 1 pasta por módulo
│   │   └── src/ui/          # design system
│   └── worker/              # Python 3.12: jobs, conectores, llm, rules
├── db/
│   ├── migrations/          # SQL versionado (dbmate: -- migrate:up / -- migrate:down)
│   ├── tests/               # pgTAP: RLS e isolamento A x B
│   ├── seed.sql             # só dados fictícios
│   └── Dockerfile           # postgres:17 + pgTAP + pgvector
├── packages/shared/         # tipos gerados do banco, enums, schemas Zod
├── infra/                   # compose.prod.yml, Caddyfile, backup, scripts de deploy
├── compose.yml              # stack de desenvolvimento
├── docs/                    # adr, specs, threat-model, phase-reports, agents
└── .github/workflows/       # CI
```

O código da revisão 1 (`supabase/`, `apps/web`) fica congelado como referência. Cada parte é removida no mesmo PR que entrega o equivalente na stack nova.

### Padrões técnicos

- **API:** NestJS com módulos por domínio; DTOs validados por Zod (`nestjs-zod`); todo controller passa por `SessaoGuard` e declara `@Permissao(modulo, acao)`. Endpoint sem decorator de permissão falha no teste de cobertura de rotas. Toda consulta de usuário roda em `comContexto(req, tx => ...)`, com papel `vv_api` e `set local app.*`. Logs JSON (pino) sem PII.
- **App:** Expo Router, TanStack Query, React Hook Form + Zod, componentes próprios sobre React Native (lista de cards no celular, tabela no web largo), `expo-secure-store` para o token nativo. Toda tela nasce em 360 px. Testes com Jest + React Native Testing Library; Playwright no web build.
- **Worker:** Ruff + mypy, pytest, jobs idempotentes (chave de idempotência por execução), logs JSON sem PII, conexão com papel `vv_worker`.
- **Banco:** toda tabela privada com `empresa_id`, UUID v7, `created_at`, `updated_at`, `created_by`, `deleted_at` (soft delete), dinheiro em `numeric(18,4)`. Papéis: `vv_owner` (migrations), `vv_api` (sem BYPASSRLS), `vv_worker` (BYPASSRLS, com validação de `empresa_id` em código).
- **Dinheiro:** `numeric(18,4)` no banco, `decimal.Decimal` no Python, `string` no JSON e no TS (cálculo no TS, quando inevitável, com `decimal.js`). Nunca `float`/`number`.
- **CI (GitHub Actions):** lint, typecheck, testes da API (com Postgres em serviço), testes do app, pytest, pgTAP, build das imagens Docker, Semgrep, Gitleaks, `npm audit` + `pip-audit`, Trivy nas imagens.

### Fluxo com agentes por fase

O "método obrigatório por fase" do Prompt vira um loop que cabe numa pessoa só:

1. **Spec:** `docs/specs/fase-XX.md` (campos, regras, endpoints, permissões, ameaças). O jurídico VV aprova o que for regra legal.
2. **Migration:** o agente gera SQL + policies RLS + testes pgTAP. Você revisa linha a linha.
3. **API:** o agente implementa módulos, guards e jobs com testes primeiro, incluindo o A x B de cada endpoint novo.
4. **App:** o agente monta as telas a partir da spec, mobile-first, nas três plataformas.
5. **Testes de isolamento:** o CI roda A x B por tabela (pgTAP) e por endpoint (e2e). PR não entra sem verde.
6. **Relatório de fase:** o agente gera `phase-reports/fase-XX.md`; você anexa as evidências.

## Modelo de dados núcleo e RLS

O banco separa dados públicos compartilháveis (editais, órgãos, itens, base jurídica) de dados privados por empresa (preços, análises, peças). Só os privados carregam `empresa_id` e RLS por empresa. Os públicos podem ser lidos por qualquer usuário autenticado, e só o worker escreve neles.

### Schemas

| Schema | Conteúdo | Quem escreve |
| --- | --- | --- |
| `core` | empresas, usuários, credenciais, sessões, MFA, vínculos, permissões, notificações | API |
| `pub` | órgãos, editais, itens, arquivos de edital, resultados públicos, feriados, base jurídica | Worker |
| `priv` | produtos da empresa, documentos, agenda, análises, preços, propostas, peças, contratos | API (usuários com permissão) |
| `ops` | fontes, execuções, `jobs`, métricas de cobertura | Worker (API só enfileira) |
| `audit` | `audit_log` insert-only | Triggers |

### Tabelas principais por onda

| Onda | Tabelas |
| --- | --- |
| 1 Fundação | `core.empresas`, `core.usuarios` (e-mail, hash Argon2id, status), `core.sessoes`, `core.fatores_mfa`, `core.codigos_recuperacao`, `core.tentativas_login`, `core.tokens_recuperacao`, `core.vinculos`, `core.permissoes`, `core.step_up_tokens`, `core.aprovacoes_exclusao`, `core.convites`, `core.notificacoes`, `core.dispositivos_push`, `audit.audit_log`, `ops.jobs` |
| 2 MVP | `core.representantes`, `core.procuracoes`, `priv.produtos`, `priv.produto_atributos`, `pub.categorias`, `pub.atributos_def` (tipo + unidade), `pub.unidades` (fator de conversão), `priv.fichas_tecnicas`, `priv.palavras_chave`, `priv.documentos`, `priv.documento_versoes`, `pub.tipos_documento`, `pub.orgaos`, `pub.editais`, `pub.edital_itens`, `priv.participacoes` (empresa x item), `priv.eventos_agenda`, `pub.regras_prazo` (com artigo), `pub.feriados`, `priv.importacoes` |
| 3 Captura | `ops.fontes`, `ops.execucoes`, `ops.execucao_fonte`, `pub.edital_arquivos` (hash, URL, coleta), `pub.edital_versoes`, `pub.trechos` (texto + página + embedding), `priv.relevancia`, `ops.amostra_cobertura` |
| 4 Análise | `priv.analises`, `priv.requisitos`, `priv.matriz_linhas` (com citações), `priv.sinalizacoes_juridicas`, `ops.llm_execucoes` (modelo, prompt, versão, custo), `ops.eval_casos` |
| 5 Proposta | `priv.composicoes_custo`, `priv.cenarios_preco`, `pub.precos_historicos`, `priv.propostas`, `priv.proposta_versoes`, `priv.declaracoes`, `priv.modelos_documento` |
| 6 Jurídico | `pub.base_juridica` (lei, artigo, acórdão, link), `priv.pecas`, `priv.peca_versoes`, `priv.teses`, `priv.pareceres_recursais`, `priv.resultados_disputa` |
| 7 Pós | `priv.contratos`, `priv.aditivos`, `priv.empenhos`, `priv.ordens_fornecimento`, `priv.etapas_fornecimento`, `priv.faturas`, `priv.recebimentos` |

### Padrão de RLS

A API conecta como `vv_api` e, a cada requisição autenticada, abre uma transação com o contexto da sessão. Toda policy privada chama uma única função, para que o teste de isolamento cubra a regra inteira:

```sql
-- contexto definido pela API no início da transação (set_config(..., true) = só nesta transação)
select set_config('app.usuario_id', $1, true),
       set_config('app.sessao_id',  $2, true),
       set_config('app.aal',        $3, true);

create function core.usuario_atual() returns uuid language sql stable as $$
  select nullif(current_setting('app.usuario_id', true), '')::uuid
$$;

create function core.has_permission(p_empresa uuid, p_modulo text, p_acao text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from core.vinculos v
    join core.permissoes p on p.vinculo_id = v.id
    where v.usuario_id = core.usuario_atual()
      and v.empresa_id = p_empresa
      and v.ativo and v.deleted_at is null
      and p.modulo = p_modulo and p.acao = p_acao
  ) or core.is_superadmin();
$$;

create policy sel on priv.documentos for select to vv_api
  using (core.has_permission(empresa_id, 'documentos', 'visualizar'));
```

- **Negar por padrão:** RLS ligado em toda tabela; sem policy, ninguém lê. `vv_api` só tem os grants explícitos de cada migration.
- **MFA no banco:** perfis internos exigem `current_setting('app.aal') = 'aal2'` dentro de `has_permission`. A API só grava `aal2` depois do TOTP.
- **Contexto vazado entre requisições:** impossível por construção, porque `set_config(..., true)` vale só para a transação. Um teste e2e confere que uma conexão devolvida ao pool não carrega usuário.
- **Permissões no token:** não. Consultar a tabela é barato e a revogação vale na hora.
- **Teste A x B:** o pgTAP cria duas empresas e dois usuários e tenta SELECT/UPDATE/DELETE cruzado em toda tabela de `priv`. O e2e da API faz o mesmo em todo endpoint (403/404). O CI falha se existir tabela em `priv` ou rota sem teste correspondente.

## Plano detalhado por fase

Cada fase abaixo traz o que entra, as tarefas em ordem, o critério de aceite herdado do Prompt e a estimativa em horas (você + agentes). As horas assumem que os agentes escrevem \~70% do código e você gasta o tempo em spec, revisão e teste. As fases 00 e 01 cresceram porque auth, storage e fila deixaram de vir prontos.

### Fase 00 · Fundação técnica · \~40 h

Nenhum código de negócio antes desta fase fechada.

- [x] Monorepo, `CLAUDE.md`/`AGENTS.md` com as regras do Prompt (atualizar para a stack nova)
- [x] `docs/threat-model.md` com as 7 ameaças do Prompt (revisar para API própria)
- [ ] ADR-011 a ADR-017 escritas e aprovadas
- [ ] `compose.yml` de desenvolvimento: `postgres` (imagem própria com pgTAP + pgvector), `minio`, `mailpit`, `api`, `worker`, `clamav`
- [ ] `db/`: dbmate, papéis `vv_owner`/`vv_api`/`vv_worker`, schemas vazios, guarda pgTAP global (RLS ligado em tudo)
- [ ] `apps/api`: NestJS com `/health` (checa banco), logs JSON, config validada por Zod, Dockerfile multi-stage
- [ ] `apps/app`: Expo com Expo Router, faixa colorida "DESENVOLVIMENTO" fora de prod, tela inicial chamando `/health`, rodando em iOS, Android e Web
- [ ] `apps/worker` no Compose, conectando como `vv_worker`
- [ ] CI: lint, typecheck e testes dos três apps, pgTAP, build das imagens, Semgrep, Gitleaks, audit de dependências, Trivy
- [ ] Guardas: Semgrep proíbe credencial `vv_worker`/`vv_owner` em `apps/app` e `apps/api`; hook do Claude Code atualizado
- [ ] Sentry (app + API + worker) e Healthchecks.io
- [ ] Produção vazia: VPS com Docker, Caddy (TLS), `compose.prod.yml`, deploy pelo pipeline do `main`

**Aceite:** `docker compose up` sobe a stack inteira e o app mostra a API saudável nas três plataformas; CI verde no `main`; deploy automático; ADRs e modelo de ameaças aprovados.

### Fase 01 · Arquitetura, segurança e acessos · \~90 h

Reaproveita o schema, a RLS e os testes pgTAP da revisão 1, portados para `db/migrations` sem `auth.*`.

- [ ] Port das migrations `core` e `audit` (empresas, usuarios, vinculos, permissoes, step\_up\_tokens, aprovacoes\_exclusao, notificacoes, convites, audit\_log) para o contexto `app.*`
- [ ] Tabelas de auth: `sessoes`, `fatores_mfa`, `codigos_recuperacao`, `tentativas_login`, `tokens_recuperacao`
- [ ] API `auth`: login (Argon2id), senha ≥ 12 + verificação de senha vazada, bloqueio progressivo por usuário e IP, recuperação neutra (token de uso único, 30 min) por e-mail
- [ ] Sessão: cookie HttpOnly/Secure/SameSite + CSRF no web; token opaco no nativo; inatividade de 30 min, absoluta de 12 h, rotação
- [ ] MFA TOTP obrigatório para SUPERADMIN, ADMIN\_EMPRESA, OPERADOR e JURÍDICO; códigos de recuperação de uso único
- [ ] Sessões ativas + "sair de todos os dispositivos"
- [ ] Step-up: TOTP novo gera token de 5 min, uso único, preso à sessão, para operações críticas
- [ ] `has_permission()` + policies + guard `@Permissao` + teste A x B por tabela e por endpoint
- [ ] Matriz de permissões (12 ações do Prompt), convites com aceite, exclusão definitiva com dupla aprovação
- [ ] App: login, MFA, recuperação, shell (menu lateral no web largo, tabs no celular), seletor de empresa, notificações, conta, matriz e convites
- [ ] Push: registro de dispositivo (Expo Notifications) e inscrição Web Push
- [ ] LGPD: inventário em `docs/lgpd.md`, minuta do contrato operador/controlador (jurídico VV)
- [ ] Backup: WAL contínuo + base semanal cifrados para bucket externo; primeiro teste de restauração documentado

**Aceite:** os 6 critérios do Prompt, com destaque para o CLIENTE que tenta acessar outra empresa por URL/requisição e recebe 403/404 (teste automatizado em todo endpoint) e para a restauração de backup testada.

### Fase 02 · Empresas, representantes e produtos · \~50 h

- [ ] Cadastro de empresa com todos os campos do Prompt, CNPJ com dígito verificador (app, API e banco), ME/EPP com data de referência
- [ ] Dados bancários e PIX cifrados em campo (ADR-017), exibidos mascarados
- [ ] Representantes e procuradores: poderes, validade, OAB; função `signatario_valido(id, data)` usada por toda geração de documento
- [ ] Catálogo universal: categorias, `atributos_def` tipados (número, texto, lista, sim/não) com unidade, `unidades` com fator de conversão (cv↔kW, GB↔TB, mm↔m)
- [ ] Produto compartilhável entre empresas com dados comerciais segregados (`produtos` público do fabricante x `produto_empresa` privado com custo e preço)
- [ ] Fichas técnicas versionadas (fabricante, modelo, versão, ano, fonte, validade, descontinuado)
- [ ] Seed de atributos de veículos: motorização, potência, torque, combustível, tração, câmbio, dimensões, capacidade, garantia
- [ ] Palavras-chave por empresa: termos, sinônimos, exclusões (só reduzem nota), UFs, municípios, faixa de valor

**Aceite:** novo atributo sem migration; CNPJ inválido e signatário vencido bloqueados; produto em duas empresas sem vazar custo.

### Fase 03 · Gestão documental e certidões · \~60 h

- [ ] Bucket privado com prefixos `quarentena/` e `documentos/{empresa_id}/{doc_id}/{versao}`; só a API e o worker têm credencial
- [ ] Upload: a API emite presigned PUT para `quarentena/` depois de checar a permissão; o worker roda ClamAV + validação de tipo real (`python-magic`) + limite de tamanho + SHA-256 e só então move
- [ ] Pastas do Prompt como `tipos_documento` (habilitação jurídica, econômico-financeira, fiscal/trabalhista, técnica, timbrado, jurídico)
- [ ] Cadastro com todos os campos de 3.2 e histórico de versões (nunca sobrescreve)
- [ ] Status calculado (Válido, A vencer, Vencido, Em atualização, Pendente, Erro) via view
- [ ] Job diário do worker gera alertas D-30/15/10/5 (configurável por tipo) por push, e-mail e in-app
- [ ] Alerta de documento que vence antes de disputa agendada (cruza com a agenda da Fase 05)
- [ ] Botão ATUALIZAR DOCUMENTO: no MVP gera pendência com instruções e link do emissor (Receita, PGFN, TST, Caixa). Integrações reais ficam na Fase 13
- [ ] Serviço único `checklist_documental(empresa, exigencias, data_sessao)` no worker, com sinalização ME/EPP (LC 123, art. 43, §1º)
- [ ] Download: a API checa a permissão, gera presigned GET de 60 s e grava auditoria
- [ ] Atestados técnicos com quantidades e características estruturadas (base para checklist e recursos)

**Aceite:** arquivo EICAR de teste bloqueado, versões preservadas, alertas disparando nas datas certas (teste com relógio simulado), download de outra empresa negado.

### Fase 04 · Motor de pesquisa automática · \~90 h

Como na ordem de ondas do Prompt, a Fase 04 vem depois do MVP (a 05 entra antes), mas o modelo `pub.editais` já nasce na Onda 2 para a importação manual.

- [ ] `ops.fontes` com todos os campos de 4.3 e `ops.execucoes` (início, fim, status, contagens por etapa)
- [ ] O agendador do worker enfileira em `ops.jobs` às 07h00, 12h00 e 17h00 (fuso `America/Sao_Paulo` direto no agendador)
- [ ] Heartbeat: cada execução pinga o Healthchecks.io; ausência em 30 min gera alerta por e-mail e push ao SUPERADMIN
- [ ] Conector PNCP (API pública de consulta): filtro por UF (PR, SC), data de publicação, modalidade; paginação; retry exponencial; identificação do robô no User-Agent
- [ ] Download de edital, TR, ETP e anexos: quarentena + ClamAV + SHA-256 + URL + data de coleta
- [ ] Extração: PyMuPDF para texto com página, OCR (Tesseract por) para escaneados, `openpyxl` para planilhas; `pub.trechos` guarda texto + arquivo + página
- [ ] Itens individualizados (item e lote), marcação ME/EPP exclusivo, cota reservada, ampla concorrência
- [ ] Deduplicação por chave composta (número de controle PNCP, órgão, edital, lote, item); retificação cria `edital_versoes` e dispara reavaliação
- [ ] Relevância: pontuação por palavras-chave (full-text) + similaridade semântica (`pgvector`) com o catálogo da empresa; nota baixa vai para "Baixa relevância", nunca some
- [ ] Painel de cobertura (todos os indicadores de 4.9) + importação manual por URL ou upload
- [ ] Amostra de referência: tabela com 50+ editais reais de PR/SC levantados manualmente; job mensal calcula a cobertura e lista os não encontrados
- [ ] Conector Compras.gov.br (dados abertos) como segunda fonte

**Aceite:** execução automática com alerta quando falha, edital de 8 itens vira 8 registros, sem duplicatas, cobertura medida na amostra (meta ≥ 95%).

### Fase 05 · Agenda e prazos jurídicos · \~70 h

Coração do MVP. Substitui a planilha.

- [ ] Modelo da agenda a partir dos 40 campos de 5.2, cruzado com as colunas da planilha atual quando ela chegar
- [ ] `priv.participacoes` (empresa x item) concentra status, responsável, prioridade e situações (documentação, proposta, jurídica)
- [ ] Visualizações: lista de cards no celular, tabela no web, dia, semana, mês, por empresa, por responsável, consolidada
- [ ] `pub.feriados`: nacionais, PR, SC e municipais dos órgãos (carga inicial + cadastro manual)
- [ ] Módulo `rules/prazos.py` no worker: dias úteis por município do órgão, regra parametrizada com artigo, prioridade do edital sobre a lei, data interna recomendada (padrão D-2 úteis). A API pede o cálculo por job e nunca recalcula em TS
- [ ] `pub.regras_prazo` com os 7 eventos da tabela 5.3, validada pelo jurídico VV
- [ ] Geração automática dos eventos ao cadastrar/atualizar edital; mudança de data de abertura recalcula tudo e notifica
- [ ] Override manual de prazo com justificativa auditada
- [ ] Status dos eventos (Sugerido → … → Prazo perdido / Dispensado)
- [ ] Alertas D-5, D-3, D-1 e no dia, com escalonamento ao gestor se nenhuma ação for registrada
- [ ] Importação Excel: mapeamento de colunas assistido, preview, detecção de duplicatas, associação de empresas, relatório de inconsistentes
- [ ] Exportação Excel preservando os campos
- [ ] Diff entre versões do edital (data, hora, quantidade, valor, descritivo)
- [ ] Google Calendar: sincronização unidirecional dos prazos por usuário (OAuth), sem dados sensíveis no título

**Aceite:** 30+ casos de teste de prazo escritos pelo jurídico VV (com feriados e fins de semana) passando, importação da planilha real sem perda, cada item aparecendo separado.

### Fase 06 · IA para análise técnica (veículos primeiro) · \~100 h

- [ ] Camada `llm/` no worker com LiteLLM: provedor e modelo por empresa, chave VV padrão ou BYOK cifrada (ADR-017), timeout, retry, custo registrado em `ops.llm_execucoes`
- [ ] Tela de configuração de IA (SUPERADMIN e ADMIN\_EMPRESA): provedor, modelo, chave mascarada, botão "testar conexão"
- [ ] Extração de requisitos por item com saída estruturada (JSON schema): tipo (obrigatório, mínimo, máximo, faixa, opcional, certificação, garantia...), valor, unidade, citação literal, página
- [ ] Verificador de citação: busca fuzzy do trecho no `pub.trechos` da página citada; se não achar, vira A CONFIRMAR
- [ ] Comparação numérica em código (`rules/unidades.py`): normaliza a unidade e compara; a IA nunca decide "≥"
- [ ] Matriz por item: uma linha por exigência com as 4 classificações; regra central travada em código (obrigatório não atendido impede ATENDE integral)
- [ ] Produtos alternativos do catálogo ranqueados por aderência
- [ ] Sinalizações jurídicas (ambiguidade → esclarecimento; restrição → impugnação) com cláusula, página, trecho e motivo
- [ ] Proteção contra prompt injection: texto do edital entra delimitado como dado, modelo sem ferramentas de escrita, saída validada por schema
- [ ] Envio mínimo: sem custos, margens ou dados pessoais no prompt
- [ ] Conjunto de avaliação: 20 editais de veículos com gabarito revisado; script mede o recall de requisitos (meta ≥ 98%) e os falsos ATENDE (meta zero); roda no CI quando muda prompt, modelo ou provedor
- [ ] Aprovação humana registrada antes de "Participar"; correções do usuário viram novos casos de teste

**Aceite:** metas de qualidade atingidas no conjunto de teste para pelo menos um provedor, citações verificadas, retificação dispara reanálise.

### Fase 07 · Formação de preços · \~50 h

- [ ] Composição de custos com todos os itens de 7.1, parâmetros tributários por empresa validados pelo contador
- [ ] `rules/precos.py` em `Decimal` no worker: custo total, preço mínimo, margens, arredondamento por edital, total = quantidade × unitário arredondado
- [ ] Valor por extenso (`num2words` pt\_BR) com testes de borda (centavos, milhões, R$ 1,00)
- [ ] Cenários: inicial, alvo, mínimo autorizado, pós-negociação; simulação de empate ficto ME/EPP (5% pregão, 10% demais)
- [ ] Risco de inexequibilidade por critério parametrizado
- [ ] Histórico de preços vencedores importado do PNCP (resultados)
- [ ] Alçada comercial por empresa; preço abaixo do mínimo exige step-up + justificativa
- [ ] Permissão "Ver custos e margens" esconde colunas inteiras (view separada com RLS e DTO separado na API, não só no app)

**Aceite:** cálculos reproduzíveis com 100% de cobertura em `rules/precos.py`, bloqueio abaixo da margem, valores segregados por empresa.

### Fase 08 · Propostas, declarações e habilitação · \~70 h

- [ ] Modelos DOCX por empresa com placeholders Jinja (`docxtpl`), papel timbrado preservado; o modelo do edital tem prioridade
- [ ] Proposta inicial e final como versões da mesma proposta; a final recalcula totais e extenso
- [ ] Identificação das declarações exigidas (IA lista, humano confirma) e geração separada de cada uma
- [ ] Checklist de habilitação reutilizando o serviço da Fase 03
- [ ] Validação bloqueante antes de liberar: CNPJ, razão social, signatário válido na data, número do edital, itens/quantidades/totais, marca/modelo = análise aprovada, documentos válidos na sessão
- [ ] Fluxo RASCUNHO → CONFERÊNCIA → APROVAÇÃO (step-up) → DOCUMENTO FINAL (hash, imutável)
- [ ] PDF via LibreOffice headless no worker (imagem Docker com fontes instaladas)
- [ ] Registro manual de envio ao portal com upload do comprovante

**Aceite:** DOCX abre idêntico ao modelo no Word, divergência de total bloqueia, versões anteriores preservadas.

### Fase 09 · Disputas e resultados · \~35 h

- [ ] 20 status de participação de 9.1 como enum + máquina de estados (transições permitidas em código, na API)
- [ ] Registro de resultado por item/lote (valores, classificação, vencedora com CNPJ, marca/modelo, motivo)
- [ ] Gatilho: não ficar em 1º, ser inabilitada ou ser desclassificada abre análise recursal (Fase 10.4) e alerta de intenção de recurso
- [ ] Banco histórico pesquisável por todos os filtros de 9.4
- [ ] Pasta de documentos posteriores (ata, adjudicação, homologação, empenhos)

**Aceite:** arrematação distinta de homologação, perda dispara análise recursal, busca histórica correta.

### Fase 10 · Módulo jurídico · \~110 h

Dividida em duas entregas: 10.2 e 10.3 (pré-disputa, \~45 h) na Onda 5; 10.4 a 10.9 (pós-disputa, \~65 h) na Onda 6.

- [ ] `pub.base_juridica`: Lei 14.133, LC 123, decretos e jurisprudência (TCU, TCE-PR, TCE-SC) cadastrados pelo jurídico VV, com número, data, ementa, link oficial
- [ ] Verificador de citações: toda citação legal na minuta é extraída por regex + IA e conferida contra a base; citação não localizada bloqueia a peça
- [ ] Pedido de esclarecimento: sugestão a partir das sinalizações da Fase 06, minuta com perguntas numeradas
- [ ] Impugnação: sugestão só dentro do prazo, grau de viabilidade justificado, minuta com qualificação, tempestividade, fatos, fundamentos, pedidos
- [ ] Resposta da Administração: registro e verificação de alteração do edital (dispara reanálise)
- [ ] Análise da vencedora: upload dos documentos da arrematante, checklist (3.5), matriz técnica (06), verificação da proposta
- [ ] Parecer de viabilidade recursal com falhas classificadas (forte, moderada, fraca) e recomendação
- [ ] Recurso: minuta das razões a partir do parecer
- [ ] Contrarrazões: extração das alegações, tabela alegação → prova → fundamento, pontos de risco marcados
- [ ] Fluxo das 9 etapas de 10.7; DOCUMENTO FINAL só com aprovação de perfil JURÍDICO + step-up
- [ ] Banco de teses com resultado de cada uso; indicadores de 10.9

**Aceite:** teste automatizado prova que nenhuma minuta passa com citação fora da base; recurso de terceiro gera prazo de contrarrazões e minuta ponto a ponto.

### Fase 11 · Contratos, entregas e financeiro · \~60 h

- [ ] Contratos e atas com aditivos e apostilamentos
- [ ] Empenhos e ordens de fornecimento com saldo calculado por trigger
- [ ] Etapas de fornecimento (11 etapas de 11.3) com prazo, responsável e anexos; kanban no web, lista no celular
- [ ] Financeiro: contratado, empenhado, faturado, recebido, saldo, dias de atraso, retenções
- [ ] Alertas de entrega, vigência, pagamento vencido, regularidade durante a execução, reajuste (encaminha ao jurídico)

**Aceite:** saldos corretos com entregas e pagamentos parciais, histórico contratual completo.

### Fase 12 · Dashboard e relatórios · \~45 h

- [ ] Dashboard por permissão com os 13 blocos de 12.1 (KPIs em cards empilhados no celular)
- [ ] Relatório diário por e-mail depois da varredura das 07h00
- [ ] Relatórios comerciais de 12.3 a partir de views materializadas
- [ ] Pesquisa histórica full-text em editais, documentos, produtos, peças e resultados
- [ ] Exportação Excel, PDF e CSV; exportação completa por empresa (CSV/JSON + arquivos em ZIP) para portabilidade

**Aceite:** números do dashboard batem com consultas SQL de conferência; exportação completa reimportável.

### Fase 13 · Integrações e expansão · \~80 h+ (contínua)

- [ ] Novos conectores: BLL, BNC, Licitanet, ComprasBR, Portal de Compras Públicas, Licitações-e, DOM/SC (cada um isolado, só com termos de uso que permitam)
- [ ] Renovação de certidões só por integração oficial ou autorizada
- [ ] WhatsApp via API oficial (Meta Cloud API) sem dados sensíveis no corpo
- [ ] Especializações por categoria: tecnologia, hospitalar, máquinas, mobiliário
- [ ] Monitoramento de publicações de resultado com lançamento automático na agenda
- [ ] Auditoria contínua de qualidade (13.6)
- [ ] Virada SaaS: onboarding self-service, planos e cobrança (Stripe ou Asaas), homologação permanente, pentest externo

**Aceite:** cada conector novo com teste próprio e painel de saúde; falha de um não derruba os outros.

## Cronograma, estimativas e custos

O plano inteiro soma \~950 h de desenvolvimento, \~1.140 h com 20% de buffer. São 40 h a mais que a revisão 1, porque auth, storage, fila e infraestrutura passam a ser nossos. A 20 h por semana (suposição: estágio + faculdade), o MVP operacional fica pronto em \~19 semanas e a plataforma completa em \~57 semanas.

```text
Onda 1 Fundação (00+01) → Onda 2 MVP (02+03+05) ★ → Onda 3 Captura (04) → Onda 4 Análise (06) → Onda 5 Proposta+jurídico pré (07+08+10.2-10.3) → Onda 6 Disputa+jurídico pós (09+10.4-10.9) → Onda 7 Pós (11+12) → Onda 8 Expansão (13)
```

As ondas rodam em sequência porque o desenvolvimento é solo; cada uma fecha com o relatório de fase do Prompt antes da próxima começar. O MVP é o marco que importa: a partir dele a VV já opera sem a planilha.

### Custo equivalente de desenvolvimento

Referência do projeto: R$ 50/h e US$ 20/h para dev júnior, fórmula horas × taxa + 20% de buffer.

| Recorte | Horas base | Com buffer 20% | BRL | USD |
| --- | --- | --- | --- | --- |
| MVP (Ondas 1 e 2) | 310 h | 372 h | R$ 18.600 | US$ 7.440 |
| V1 (Ondas 1 a 6) | 765 h | 918 h | R$ 45.900 | US$ 18.360 |
| Completo (Ondas 1 a 8) | 950 h | 1.140 h | R$ 57.000 | US$ 22.800 |

Dificuldade geral: **4 de 5**. Não pela stack, que é comum, mas pela soma de multi-tenant com isolamento comprovado, auth própria, regras jurídicas de prazo e IA com evidência verificável. As Fases 01, 04, 06 e 10 concentram o risco.

### Infraestrutura mensal (valores aproximados, conferir antes de contratar)

| Item | Fase inicial | Com 1º cliente real |
| --- | --- | --- |
| VPS produção (4 vCPU, 8 GB, São Paulo) com Docker | US$ 20 a 40 | US$ 40 a 60 |
| VPS homologação | não | US$ 10 a 20 |
| Armazenamento S3 privado + backup externo (ex.: Cloudflare R2) | \~US$ 1 a 5 | \~US$ 5 a 10 |
| E-mail transacional (Resend ou similar) | grátis | US$ 20 |
| Expo EAS (builds e updates) | grátis | US$ 0 a 19 |
| Apple Developer Program | US$ 99/ano (\~US$ 8/mês) | idem |
| Google Play (taxa única) | US$ 25 | — |
| Sentry, Healthchecks.io | grátis | grátis |
| **Total** | **\~US$ 30 a 55** | **\~US$ 85 a 135** |

IA fica fora da conta: com chave VV, o custo por edital depende do provedor e do tamanho do PDF; `ops.llm_execucoes` mede isso desde a Fase 06 para precificar o SaaS. Com BYOK, o custo é do cliente.

## Riscos, dependências e pendências

O maior risco não é técnico: é um prazo jurídico calculado errado ou um ATENDE indevido chegar ao cliente. Por isso prazos, preços e comparações ficam em código puro testado, e a IA nunca tem a palavra final.

| Risco | Tipo | Impacto | Mitigação |
| --- | --- | --- | --- |
| Prazo jurídico calculado errado (feriado municipal faltando) | Produto/legal | Crítico: preclusão | Casos de teste do jurídico VV no CI, data interna D-2, override auditado, feriado ausente gera aviso |
| Vazamento entre empresas | Segurança | Crítico | Guard + RLS, `has_permission()` única, A x B por tabela e por endpoint, CI falha sem teste |
| Bug na auth própria (sessão, MFA, recuperação) | Segurança | Crítico | Bibliotecas maduras (`argon2`, `otplib`), testes de cada fluxo e de ataque (força bruta, replay, fixação de sessão), revisão `revisor-seguranca`, pentest antes do 1º cliente |
| Contexto de usuário vazando entre requisições no pool | Segurança | Crítico | `set_config(..., true)` só na transação; teste e2e dedicado |
| Agente de IA desliga RLS ou usa a credencial do worker na API/app | Segurança | Crítico | Regra no `AGENTS.md`, Semgrep custom, revisão humana de toda migration |
| Servidor único (VPS) cai ou é comprometido | Operação | Alto | Backup com PITR fora do servidor, restauração testada, hardening (SSH só por chave, firewall, atualizações automáticas), imagens com Trivy |
| IA marca ATENDE sem evidência | Produto | Alto | Verificador de citação, comparação numérica em código, regra central travada, conjunto de avaliação no CI |
| Minuta com artigo ou acórdão inventado | Legal | Alto | Base jurídica fechada + bloqueio de citação não localizada |
| API do PNCP fora do ar ou mudando contrato | Técnico | Alto | Conector isolado, retry, painel de cobertura, alerta em vez de "zero resultados" |
| Revisão das lojas (Apple/Google) atrasando entrega | Projeto | Médio | Web build como canal principal no começo; atualizações OTA (EAS Update) para JS |
| Prompt injection em edital | Segurança | Médio | Texto delimitado como dado, modelo sem ferramentas de escrita, saída por schema |
| Custo de IA explodindo com PDFs grandes | Financeiro | Médio | Extrair só o trecho do item, cache por hash de arquivo, limite mensal por empresa |
| Pessoa única como gargalo e ponto de falha | Projeto | Alto | Docs e ADRs em dia, relatório por fase, nada de conhecimento só na cabeça |
| Planilha atual com formato diferente do previsto | Produto | Médio | Importação com mapeamento assistido; ajustar o modelo da agenda antes da Fase 05 |
| LGPD sem contrato operador/controlador | Legal | Alto | Bloqueante para o 1º cliente real; jurídico VV redige na Onda 1 |

### Dependências externas

- **Jurídico VV:** tabela de regras de prazo, 30+ casos de teste, base jurídica, revisão de minutas, contrato LGPD.
- **Contador:** parâmetros tributários da Fase 07.
- **Operação VV:** planilha atual, 50 editais da amostra de cobertura, 20 editais de veículos com gabarito para a Fase 06.

### Pendências abertas

- [ ] Instalar Docker (Docker Desktop ou OrbStack) na máquina de desenvolvimento
- [ ] Escolher o provedor da VPS em São Paulo e o provedor S3 de produção
- [ ] Contas Apple Developer e Google Play (quando o app nativo for para as lojas)
- [ ] Decidir o destino do projeto Supabase criado na revisão 1 (pausar ou excluir)
- [ ] Enviar a planilha Excel atual de agenda (bloqueia o desenho final da Fase 05)
- [ ] Confirmar a dedicação semanal real (o cronograma assume 20 h)
- [ ] Decidir a ADR-007: cofre separado para certificado A1 agora ou só quando houver integração que use
- [ ] Definir domínio e identidade visual (nome, logo, cores, ícone do app)
- [ ] Confirmar se usuários CLIENTE usam o app no MVP ou só a equipe VV
