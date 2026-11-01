# VV Licitações · Plano de Desenvolvimento

> Cópia de referência do plano aprovado. Decisões que mudarem aqui viram ADR em `docs/adr/`.

Nov 1, 2026 · @Adriano Vale

## Visão geral e decisões

O VV Licitações será construído em 8 ondas, com React (Vite) como PWA mobile-first, Supabase como núcleo de dados e segurança, e um worker Python para tudo que é pesado. O plano segue o Prompt Mestre 2.1 fase a fase, adaptando ao Supabase o que ele permite e registrando cada desvio em ADR.

O MVP operacional (Ondas 1 e 2) substitui a planilha de agenda e o controle de certidões. A partir dele, cada onda entrega valor isolado: captura automática, análise técnica, propostas, jurídico e pós-licitação.

| Tema | Decisão | Impacto no plano |
| --- | --- | --- |
| Modelo de negócio | Híbrido: começa como consultoria VV, vira SaaS | Multi-tenant desde o dia 1; billing e onboarding self-service ficam para a Onda 8 |
| Equipe | Adriano solo + agentes de IA (Claude Code, Codex, Paseo) | PRs pequenos (< 500 linhas), specs por fase como prompt dos agentes, CI rígido como rede de segurança |
| Prazo | Sem data fixa | Estimativas em horas; ordem guiada por valor, não por calendário |
| Profundidade | 13 fases detalhadas | Cada fase tem escopo, tabelas, tarefas e critério de aceite |
| Frontend | Vite + React + TypeScript, SPA | Deploy estático na Vercel, Supabase direto do client com RLS |
| Mobile | PWA instalável + Web Push | Layout mobile-first obrigatório, service worker, push de prazos |
| Backend | Supabase + worker Python (FastAPI) | Edge Functions só para coisas leves; PNCP, PDF, IA e DOCX no worker |
| IA | Multi-provedor com token próprio (chave VV padrão, cliente pode trazer a sua) | Camada de abstração de LLM, chaves no Supabase Vault, avaliação por provedor |
| Hospedagem | Vercel (front) + Railway (worker) | Dois deploys, um pipeline |
| Ambientes | Dev local (Supabase CLI) + produção; homologação quando houver 1º cliente real | Custo inicial baixo, desvio do Prompt registrado em ADR |
| Auth | Supabase Auth adaptado (bcrypt, MFA TOTP, leaked password, time-box de sessão) | ADR documenta diferenças frente a Argon2id e cookie HttpOnly |
| Validação jurídica | Jurídico interno da VV | Dono das tabelas de prazos, base legal e casos de teste |
| Volume ano 1 | Até 10 empresas, \~20 usuários | Postgres simples resolve; sem sharding, sem fila externa no início |
| Categoria inicial (Fase 06) | Veículos | Atributos, normalização de unidades e conjunto de teste começam por veículos |
| Notificações | In-app, Web Push, e-mail, Google Calendar | WhatsApp fica para a Onda 8 |

Pendência que bloqueia a Onda 2: a planilha Excel atual de agenda. Sem ela, o modelo da agenda é desenhado pelo Prompt e ajustado depois.

## Arquitetura alvo

O PWA conversa só com o Supabase, sempre como usuário autenticado e filtrado por RLS. O worker Python consome a fila do Postgres com service role, faz o trabalho pesado e grava o resultado de volta, sem nunca expor endpoint público para o front.

```text
[PWA React/Vite]  --JWT + RLS-->  [Supabase: Postgres+RLS | Auth | Storage | Vault | pg_cron | pgmq | Edge Functions]
                                         ^                        |
                                         | service role           v fila pgmq
                                  [Worker Python/FastAPI (Railway)]  -->  PNCP, Compras.gov, LLMs, ClamAV, LibreOffice, Resend, Web Push, Google Calendar
```

Postgres + RLS está em destaque porque é onde mora o isolamento entre empresas: se ele falhar, todo o resto falha junto. Para 10 empresas e 20 usuários no primeiro ano, `pgmq` dentro do próprio Postgres substitui Redis ou RabbitMQ sem custo extra.

## Adaptações ao Supabase e ADRs iniciais

O Supabase atende a maior parte dos requisitos de segurança do Prompt nativamente; seis pontos precisam de adaptação e entram como ADR antes de qualquer código de negócio.

| Requisito do Prompt | Como fica no Supabase | Risco residual |
| --- | --- | --- |
| Argon2id ou bcrypt custo ≥ 12 | Supabase Auth usa bcrypt (custo 10 por padrão). Aceitar e compensar com senha ≥ 12, leaked password protection e MFA obrigatório | Baixo, com MFA |
| Sessão em cookie HttpOnly | SPA guarda JWT no client. Mitigação: CSP estrita, sem `dangerouslySetInnerHTML`, JWT curto (15 min), refresh rotativo | Médio, XSS vira roubo de sessão. Reavaliar BFF se virar SaaS |
| Inatividade 30 min / absoluta 12 h | Time-box e inactivity timeout do Auth (plano Pro) + logout por inatividade no front | Baixo |
| MFA obrigatório por perfil | TOTP nativo + verificação de `aal2` no RLS para perfis internos | Baixo |
| Reautenticação em operações críticas | Desafio MFA novo + tabela `step_up_tokens` (validade 5 min) checada pela função que executa a operação | Baixo |
| Isolamento em duas camadas | RLS em toda tabela privada + worker Python valida `empresa_id` em todo job (service role nunca exposta ao front) | Baixo, com teste A x B |
| Criptografia de campo + KMS | Supabase Vault (pgsodium) para PIX, dados bancários, CPF, chaves de IA e senhas de portal | Médio, Vault fica no mesmo banco. Certificado A1 em cofre separado (ver ADR-007) |
| Auditoria imutável | Tabela `audit_log` insert-only, triggers genéricos, sem policy de UPDATE/DELETE, revogação para `authenticated` | Baixo |
| Antivírus em upload | Upload vai para bucket `quarentena`; worker roda ClamAV e move para bucket definitivo | Baixo |
| URL assinada curta | `createSignedUrl` com 60 s, gerada por Edge Function que audita o download | Baixo |
| Backup + PITR, RPO ≤ 24 h | Backup diário do Pro + export semanal via `pg_dump` para bucket externo (R2/S3). PITR é add-on pago | Ativar PITR antes do 1º cliente real |
| 3 ambientes | Dev local + produção; homologação via Supabase Branching quando entrar o 1º cliente | Desvio consciente, registrado |

### ADRs a escrever na Fase 00

1. **ADR-001** Stack: Vite + React + TS, Supabase, worker Python, Vercel, Railway.
2. **ADR-002** Autenticação: Supabase Auth adaptado (tabela acima).
3. **ADR-003** Multi-tenant: `empresa_id` + RLS + função `has_permission()`.
4. **ADR-004** Fila de jobs: `pgmq` (fila nativa do Postgres) consumida pelo worker, `pg_cron` para agendamentos.
5. **ADR-005** IA multi-provedor: LiteLLM no worker, chave VV padrão, BYOK por empresa no Vault.
6. **ADR-006** Geração de documentos: `docxtpl` (DOCX a partir de modelo) + LibreOffice headless para PDF.
7. **ADR-007** Certificados A1 e senhas de portal: cofre separado (Infisical ou Doppler) ou adiar, já que o sistema nunca protocola nada.
8. **ADR-008** Busca: Postgres full-text (`tsvector`, português) + `pgvector` para semântica.
9. **ADR-009** Ambientes: dev local + produção, gatilho para homologação.
10. **ADR-010** PWA: `vite-plugin-pwa`, Web Push via VAPID enviado pelo worker.

## Repositório, padrões e fluxo com agentes

Um monorepo só, com o banco como fonte da verdade: migrations SQL geram os tipos TypeScript e os modelos Pydantic, e nenhum agente escreve schema fora de migration.

```text
vv-licitacoes/
├── apps/
│   ├── web/                 # Vite + React + TS (PWA)
│   │   ├── src/features/    # 1 pasta por módulo (empresas, documentos, agenda...)
│   │   ├── src/components/  # design system (shadcn/ui)
│   │   └── src/lib/         # supabase client, permissões, formatadores BRL
│   └── worker/              # Python 3.12 + FastAPI
│       ├── jobs/            # pncp_sync, extract_pdf, analyze_item, render_docx...
│       ├── connectors/      # 1 conector isolado por fonte
│       ├── llm/             # abstração multi-provedor + prompts versionados
│       └── rules/           # prazos, preços, unidades (código puro, 80%+ cobertura)
├── supabase/
│   ├── migrations/          # SQL versionado (up + down)
│   ├── functions/           # Edge Functions leves (signed URL, webhooks)
│   ├── seed.sql             # só dados fictícios
│   └── tests/               # pgTAP: RLS e isolamento A x B
├── packages/shared/         # tipos gerados, enums, schemas Zod
├── docs/
│   ├── adr/                 # ADR-001...
│   ├── specs/               # spec por fase (vira prompt dos agentes)
│   ├── threat-model.md
│   └── phase-reports/       # relatório obrigatório ao fim de cada fase
├── CLAUDE.md / AGENTS.md    # regras do Prompt Mestre para agentes
└── .github/workflows/       # CI
```

### Padrões técnicos

- **Front:** TanStack Query para dados do Supabase, React Hook Form + Zod, TanStack Table com modo "cards" abaixo de 768 px, Tailwind + shadcn/ui.
- **Mobile-first:** toda tela nasce em 360 px. Tabelas viram lista de cards no celular, filtros em bottom sheet, ações primárias em barra fixa inferior. Teste Playwright roda em viewport iPhone e desktop.
- **Worker:** Ruff + mypy, pytest, jobs idempotentes (chave de idempotência por execução), logs JSON sem PII.
- **Banco:** toda tabela privada com `empresa_id`, UUID v7, `created_at`, `updated_at`, `created_by`, `deleted_at` (soft delete), dinheiro em `numeric(18,4)`.
- **CI (GitHub Actions):** lint, typecheck, testes, pgTAP de RLS, Semgrep (SAST), `npm audit` + `pip-audit`, Gitleaks, build. Branch `main` protegida.

### Fluxo com agentes por fase

O "método obrigatório por fase" do Prompt vira um loop que cabe numa pessoa só:

1. **Spec:** você escreve `docs/specs/fase-XX.md` (campos, regras, permissões, ameaças) com ajuda do Claude. Jurídico VV aprova o que for regra legal.
2. **Migration:** agente gera SQL + policies RLS + testes pgTAP. Você revisa linha a linha, porque é a parte que não perdoa erro.
3. **Backend:** agente implementa jobs e funções com testes primeiro.
4. **Frontend:** agente monta telas a partir da spec, mobile-first.
5. **Testes de isolamento:** CI roda A x B em toda tabela nova; PR não entra sem verde.
6. **Relatório de fase:** agente gera `phase-reports/fase-XX.md` no formato do Prompt; você anexa evidências.

Regra para os agentes no `CLAUDE.md`: copiar as 10 instruções finais do Prompt Mestre e acrescentar "nunca usar service role no front", "nunca desligar RLS" e "toda tabela nova exige teste de isolamento".

## Modelo de dados núcleo e RLS

O banco separa dados públicos compartilháveis (editais, órgãos, itens, base jurídica) de dados privados por empresa (preços, análises, peças). Só os privados carregam `empresa_id` e RLS por empresa; os públicos têm leitura para qualquer usuário autenticado e escrita só pelo worker.

### Schemas

| Schema | Conteúdo | Quem escreve |
| --- | --- | --- |
| `core` | empresas, usuários, perfis, permissões, representantes | Admin via app |
| `pub` | órgãos, editais, itens, arquivos de edital, resultados públicos, feriados, base jurídica | Worker (service role) |
| `priv` | produtos da empresa, documentos, agenda, análises, preços, propostas, peças, contratos | Usuários com permissão |
| `ops` | fontes, execuções do agendador, jobs, métricas de cobertura | Worker |
| `audit` | `audit_log` insert-only | Triggers |

### Tabelas principais por onda

| Onda | Tabelas |
| --- | --- |
| 1 Fundação | `core.empresas`, `core.usuarios` (perfil de `auth.users`), `core.vinculos` (usuário x empresa x papel), `core.permissoes` (vínculo x módulo x ação), `core.step_up_tokens`, `audit.audit_log`, `core.notificacoes` |
| 2 MVP | `core.representantes`, `core.procuracoes`, `priv.produtos`, `priv.produto_atributos`, `pub.categorias`, `pub.atributos_def` (tipo + unidade), `pub.unidades` (fator de conversão), `priv.fichas_tecnicas`, `priv.palavras_chave`, `priv.documentos`, `priv.documento_versoes`, `pub.tipos_documento`, `pub.orgaos`, `pub.editais`, `pub.edital_itens`, `priv.participacoes` (empresa x item), `priv.eventos_agenda`, `pub.regras_prazo` (com artigo), `pub.feriados`, `priv.importacoes` |
| 3 Captura | `ops.fontes`, `ops.execucoes`, `ops.execucao_fonte`, `pub.edital_arquivos` (hash, URL, coleta), `pub.edital_versoes`, `pub.trechos` (texto + página + embedding), `priv.relevancia`, `ops.amostra_cobertura` |
| 4 Análise | `priv.analises`, `priv.requisitos`, `priv.matriz_linhas` (com citações), `priv.sinalizacoes_juridicas`, `ops.llm_execucoes` (modelo, prompt, versão, custo), `ops.eval_casos` |
| 5 Proposta | `priv.composicoes_custo`, `priv.cenarios_preco`, `pub.precos_historicos`, `priv.propostas`, `priv.proposta_versoes`, `priv.declaracoes`, `priv.modelos_documento` |
| 6 Jurídico | `pub.base_juridica` (lei, artigo, acórdão, link), `priv.pecas`, `priv.peca_versoes`, `priv.teses`, `priv.pareceres_recursais`, `priv.resultados_disputa` |
| 7 Pós | `priv.contratos`, `priv.aditivos`, `priv.empenhos`, `priv.ordens_fornecimento`, `priv.etapas_fornecimento`, `priv.faturas`, `priv.recebimentos` |

### Padrão de RLS

Toda policy privada chama uma única função, para que o teste de isolamento cubra a regra inteira:

```sql
create function core.has_permission(p_empresa uuid, p_modulo text, p_acao text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from core.vinculos v
    join core.permissoes p on p.vinculo_id = v.id
    where v.usuario_id = auth.uid()
      and v.empresa_id = p_empresa
      and v.ativo and v.deleted_at is null
      and p.modulo = p_modulo and p.acao = p_acao
  ) or core.is_superadmin();
$$;

create policy sel on priv.documentos for select to authenticated
  using (core.has_permission(empresa_id, 'documentos', 'visualizar'));
```

- **Negar por padrão:** RLS ligado em toda tabela; sem policy, ninguém lê.
- **MFA no banco:** perfis internos exigem `(auth.jwt()->>'aal') = 'aal2'` dentro de `has_permission`.
- **Permissões no JWT:** não. Com 20 usuários, consultar a tabela é barato e evita token desatualizado após revogação.
- **Teste A x B:** pgTAP cria duas empresas, dois usuários e tenta SELECT/UPDATE/DELETE cruzado em toda tabela de `priv`. Um script no CI falha se existir tabela em `priv` sem teste correspondente.
- **Dinheiro:** `numeric(18,4)` no banco, `decimal.Decimal` no worker, string no JSON. Nada de `float` em lugar nenhum.

## Plano detalhado por fase

Cada fase abaixo traz o que entra, as tarefas em ordem de execução, o critério de aceite herdado do Prompt e a estimativa em horas (você + agentes). Horas assumem que agentes escrevem \~70% do código e você gasta o tempo em spec, revisão e teste.

### Fase 00 · Fundação técnica · \~30 h

Nenhum código de negócio antes desta fase fechada.

- [ ] Criar monorepo, `CLAUDE.md`/`AGENTS.md` com as regras do Prompt
- [ ] Projeto Supabase de produção (Pro) + Supabase CLI local com `seed.sql` fictício
- [ ] Faixa colorida "DESENVOLVIMENTO" no front quando `VITE_ENV != prod`
- [ ] Escrever ADR-001 a ADR-010
- [ ] `docs/threat-model.md` com as 7 ameaças do Prompt, controle e teste de cada uma
- [ ] CI: lint, typecheck, pytest, pgTAP, Semgrep, Gitleaks, audit de dependências
- [ ] Sentry (front + worker), logs JSON do worker no Railway, Better Stack ou Healthchecks.io para heartbeat do agendador
- [ ] Deploy vazio: Vercel (front) e Railway (worker) apontando para prod

**Aceite:** CI verde no `main` protegido, deploy automático funcionando, ADRs e modelo de ameaças aprovados por você.

### Fase 01 · Arquitetura, segurança e acessos · \~60 h

- [ ] Migrations `core`: empresas, usuarios, vinculos, permissoes, step\_up\_tokens, notificacoes
- [ ] `audit.audit_log` insert-only + trigger genérico (antes/depois em JSONB, usuário, IP via header, empresa)
- [ ] `core.has_permission()` + policies + teste A x B
- [ ] Auth: login, recuperação de senha (mensagem neutra), senha ≥ 12, leaked password, rate limit do Auth
- [ ] MFA TOTP obrigatório para SUPERADMIN, ADMIN\_EMPRESA, OPERADOR, JURÍDICO; códigos de recuperação
- [ ] Tela de sessões ativas + "sair de todos os dispositivos"
- [ ] Step-up: modal de MFA que gera token de 5 min para operações críticas
- [ ] Matriz de permissões: tela por empresa x módulo x ação (12 ações do Prompt), negar por padrão
- [ ] Exclusão definitiva só SUPERADMIN com dupla aprovação (tabela `aprovacoes_pendentes`)
- [ ] Shell do app: menu lateral (desktop) / bottom nav (mobile), notificações, configurações, seletor de empresa
- [ ] PWA base: manifest, ícones, service worker, tela offline
- [ ] LGPD: inventário de dados pessoais em `docs/lgpd.md`, minuta do contrato operador/controlador (jurídico VV)
- [ ] Backup: job semanal `pg_dump` criptografado para bucket externo + primeiro teste de restauração documentado

**Aceite:** os 6 critérios do Prompt, com destaque para CLIENTE tentando acessar outra empresa por URL/requisição e recebendo vazio ou 403 (teste automatizado) e restauração de backup testada.

### Fase 02 · Empresas, representantes e produtos · \~50 h

- [ ] Cadastro de empresa: todos os campos do Prompt, CNPJ com dígito verificador (front e banco), ME/EPP com data de referência
- [ ] Dados bancários e PIX no Vault, exibidos mascarados
- [ ] Representantes e procuradores: poderes, validade, OAB; função `signatario_valido(id, data)` usada por toda geração de documento
- [ ] Catálogo universal: categorias, `atributos_def` tipados (número, texto, lista, sim/não) com unidade, `unidades` com fator de conversão (cv↔kW, GB↔TB, mm↔m)
- [ ] Produto compartilhável entre empresas com dados comerciais segregados (`produtos` público do fabricante x `produto_empresa` privado com custo e preço)
- [ ] Fichas técnicas versionadas (fabricante, modelo, versão, ano, fonte, validade, descontinuado)
- [ ] Seed de atributos de veículos: motorização, potência, torque, combustível, tração, câmbio, dimensões, capacidade, garantia
- [ ] Palavras-chave por empresa: termos, sinônimos, exclusões (só reduzem nota), UFs, municípios, faixa de valor

**Aceite:** novo atributo sem migration, CNPJ inválido e signatário vencido bloqueados, produto em duas empresas sem vazar custo.

### Fase 03 · Gestão documental e certidões · \~60 h

- [ ] Buckets `quarentena` e `documentos` privados, path `{empresa_id}/{doc_id}/{versao}`, policies de storage por empresa
- [ ] Worker: ClamAV + validação de tipo real (`python-magic`) + limite de tamanho + SHA-256; só então move para `documentos`
- [ ] Pastas do Prompt como `tipos_documento` (habilitação jurídica, econômico-financeira, fiscal/trabalhista, técnica, timbrado, jurídico)
- [ ] Cadastro com todos os campos de 3.2 e histórico de versões (nunca sobrescreve)
- [ ] Status calculado (Válido, A vencer, Vencido, Em atualização, Pendente, Erro) via view
- [ ] `pg_cron` diário gera alertas D-30/15/10/5 (configurável por tipo) por push, e-mail e in-app
- [ ] Alerta de documento que vence antes de disputa agendada (cruza com agenda da Fase 05)
- [ ] Botão ATUALIZAR DOCUMENTO: no MVP gera pendência com instruções e link do emissor (Receita, PGFN, TST, Caixa). Integrações reais ficam na Fase 13
- [ ] Serviço único `checklist_documental(empresa, exigencias, data_sessao)` no worker, com sinalização ME/EPP (LC 123, art. 43, §1º)
- [ ] Download via Edge Function: checa permissão, gera signed URL de 60 s, grava auditoria
- [ ] Atestados técnicos com quantidades e características estruturadas (base para checklist e recursos)

**Aceite:** arquivo EICAR de teste bloqueado, versões preservadas, alertas disparando nas datas certas (teste com relógio simulado), download de outra empresa negado.

### Fase 04 · Motor de pesquisa automática · \~90 h

Como na ordem de ondas do Prompt, a Fase 04 vem depois do MVP (05 entra antes), mas o modelo `pub.editais` já nasce na Onda 2 para a importação manual.

- [ ] `ops.fontes` com todos os campos de 4.3 e `ops.execucoes` (início, fim, status, contagens por etapa)
- [ ] `pg_cron` enfileira em `pgmq` às 07h00, 12h00 e 17h00 (America/Sao\_Paulo; cron do Supabase roda em UTC, então 10h, 15h e 20h UTC)
- [ ] Heartbeat: cada execução pinga Healthchecks.io; ausência em 30 min gera alerta por e-mail e push ao SUPERADMIN
- [ ] Conector PNCP (API pública de consulta): filtro por UF (PR, SC), data de publicação, modalidade; paginação; retry exponencial; identificação do robô no User-Agent
- [ ] Download de edital, TR, ETP e anexos: quarentena + ClamAV + SHA-256 + URL + data de coleta
- [ ] Extração: PyMuPDF para texto com página, OCR (Tesseract por) para escaneados, `openpyxl` para planilhas; `pub.trechos` guarda texto + arquivo + página
- [ ] Itens individualizados (item e lote), marcação ME/EPP exclusivo, cota reservada, ampla concorrência
- [ ] Deduplicação por chave composta (número de controle PNCP, órgão, edital, lote, item); retificação cria `edital_versoes` e dispara reavaliação
- [ ] Relevância: pontuação por palavras-chave (full-text) + similaridade semântica (`pgvector`) com o catálogo da empresa; baixa nota vai para "Baixa relevância", nunca some
- [ ] Painel de cobertura (todos os indicadores de 4.9) + importação manual por URL ou upload
- [ ] Amostra de referência: tabela com 50+ editais reais de PR/SC levantados manualmente; job mensal calcula cobertura e lista os não encontrados
- [ ] Conector Compras.gov.br (dados abertos) como segunda fonte

**Aceite:** execução automática com alerta quando falha, edital de 8 itens vira 8 registros, sem duplicatas, cobertura medida na amostra (meta ≥ 95%).

### Fase 05 · Agenda e prazos jurídicos · \~70 h

Coração do MVP. Substitui a planilha.

- [ ] Modelo da agenda a partir dos 40 campos de 5.2, cruzado com as colunas da planilha atual quando ela chegar
- [ ] `priv.participacoes` (empresa x item) concentra status, responsável, prioridade e situações (documentação, proposta, jurídica)
- [ ] Visualizações: tabela (cards no mobile), dia, semana, mês, por empresa, por responsável, consolidada
- [ ] `pub.feriados`: nacionais, PR, SC e municipais dos órgãos (carga inicial + cadastro manual)
- [ ] Módulo `rules/prazos.py`: dias úteis por município do órgão, regra parametrizada com artigo, prioridade do edital sobre a lei, data interna recomendada (padrão D-2 úteis)
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

- [ ] Camada `llm/` com LiteLLM: provedor e modelo por empresa, chave VV padrão ou BYOK do Vault, timeout, retry, custo registrado em `ops.llm_execucoes`
- [ ] Tela de configuração de IA (SUPERADMIN e ADMIN\_EMPRESA): provedor, modelo, chave mascarada, botão "testar conexão"
- [ ] Extração de requisitos por item com saída estruturada (JSON schema): tipo (obrigatório, mínimo, máximo, faixa, opcional, certificação, garantia...), valor, unidade, citação literal, página
- [ ] Verificador de citação: busca fuzzy do trecho no `pub.trechos` da página citada; não achou, vira A CONFIRMAR
- [ ] Comparação numérica em código (`rules/unidades.py`): normaliza unidade e compara; a IA nunca decide "≥"
- [ ] Matriz por item: uma linha por exigência com as 4 classificações; regra central travada em código (obrigatório não atendido impede ATENDE integral)
- [ ] Produtos alternativos do catálogo ranqueados por aderência
- [ ] Sinalizações jurídicas (ambiguidade → esclarecimento; restrição → impugnação) com cláusula, página, trecho e motivo
- [ ] Proteção contra prompt injection: texto do edital entra delimitado como dado, modelo sem ferramentas de escrita, saída validada por schema
- [ ] Envio mínimo: sem custos, margens ou dados pessoais no prompt
- [ ] Conjunto de avaliação: 20 editais de veículos com gabarito revisado; script mede recall de requisitos (meta ≥ 98%) e falsos ATENDE (meta zero); roda no CI quando muda prompt, modelo ou provedor
- [ ] Aprovação humana registrada antes de "Participar"; correções do usuário viram novos casos de teste

**Aceite:** metas de qualidade atingidas no conjunto de teste para pelo menos um provedor, citações verificadas, retificação dispara reanálise.

### Fase 07 · Formação de preços · \~50 h

- [ ] Composição de custos com todos os itens de 7.1, parâmetros tributários por empresa validados pelo contador
- [ ] `rules/precos.py` em `Decimal`: custo total, preço mínimo, margens, arredondamento por edital, total = quantidade × unitário arredondado
- [ ] Valor por extenso (`num2words` pt\_BR) com testes de borda (centavos, milhões, R$ 1,00)
- [ ] Cenários: inicial, alvo, mínimo autorizado, pós-negociação; simulação de empate ficto ME/EPP (5% pregão, 10% demais)
- [ ] Risco de inexequibilidade por critério parametrizado
- [ ] Histórico de preços vencedores importado do PNCP (resultados)
- [ ] Alçada comercial por empresa; preço abaixo do mínimo exige step-up + justificativa
- [ ] Permissão "Ver custos e margens" esconde colunas inteiras (RLS em view separada, não só no front)

**Aceite:** cálculos reproduzíveis com 100% de cobertura em `rules/precos.py`, bloqueio abaixo da margem, valores segregados por empresa.

### Fase 08 · Propostas, declarações e habilitação · \~70 h

- [ ] Modelos DOCX por empresa com placeholders Jinja (`docxtpl`), papel timbrado preservado; modelo do edital tem prioridade
- [ ] Proposta inicial e final como versões da mesma proposta; final recalcula totais e extenso
- [ ] Identificação das declarações exigidas (IA lista, humano confirma) e geração separada de cada uma
- [ ] Checklist de habilitação reutilizando o serviço da Fase 03
- [ ] Validação bloqueante antes de liberar: CNPJ, razão social, signatário válido na data, número do edital, itens/quantidades/totais, marca/modelo = análise aprovada, documentos válidos na sessão
- [ ] Fluxo RASCUNHO → CONFERÊNCIA → APROVAÇÃO (step-up) → DOCUMENTO FINAL (hash, imutável)
- [ ] PDF via LibreOffice headless no worker (container Railway com fontes instaladas)
- [ ] Registro manual de envio ao portal com upload do comprovante

**Aceite:** DOCX abre idêntico ao modelo no Word, divergência de total bloqueia, versões anteriores preservadas.

### Fase 09 · Disputas e resultados · \~35 h

- [ ] 20 status de participação de 9.1 como enum + máquina de estados (transições permitidas em código)
- [ ] Registro de resultado por item/lote (valores, classificação, vencedora com CNPJ, marca/modelo, motivo)
- [ ] Gatilho: não ficou em 1º, inabilitada ou desclassificada abre análise recursal (Fase 10.4) e alerta de intenção de recurso
- [ ] Banco histórico pesquisável por todos os filtros de 9.4
- [ ] Pasta de documentos posteriores (ata, adjudicação, homologação, empenhos)

**Aceite:** arrematação distinta de homologação, perda dispara análise recursal, busca histórica correta.

### Fase 10 · Módulo jurídico · \~110 h

Dividida em duas entregas: 10.2 e 10.3 (pré-disputa, \~45 h) na Onda 5; 10.4 a 10.9 (pós-disputa, \~65 h) na Onda 6.

- [ ] `pub.base_juridica`: Lei 14.133, LC 123, decretos e jurisprudência (TCU, TCE-PR, TCE-SC) cadastrados pelo jurídico VV, com número, data, ementa, link oficial
- [ ] Verificador de citações: toda citação legal na minuta é extraída por regex + IA e conferida contra a base; não localizada bloqueia a peça
- [ ] Pedido de esclarecimento: sugestão a partir das sinalizações da Fase 06, minuta com perguntas numeradas
- [ ] Impugnação: sugestão só dentro do prazo, grau de viabilidade justificado, minuta com qualificação, tempestividade, fatos, fundamentos, pedidos
- [ ] Resposta da Administração: registro e verificação de alteração do edital (dispara reanálise)
- [ ] Análise da vencedora: upload dos documentos da arrematante, checklist (3.5), matriz técnica (06), verificação da proposta
- [ ] Parecer de viabilidade recursal com falhas classificadas (forte, moderada, fraca) e recomendação
- [ ] Recurso: minuta das razões a partir do parecer
- [ ] Contrarrazões: extração das alegações, tabela alegação → prova → fundamento, pontos de risco marcados
- [ ] Fluxo das 9 etapas de 10.7; DOCUMENTO FINAL só com aprovação de perfil JURÍDICO + step-up
- [ ] Banco de teses com resultado de cada uso; indicadores de 10.9

**Aceite:** teste automatizado prova que nenhuma minuta passa com citação fora da base, recurso de terceiro gera prazo de contrarrazões e minuta ponto a ponto.

### Fase 11 · Contratos, entregas e financeiro · \~60 h

- [ ] Contratos e atas com aditivos e apostilamentos
- [ ] Empenhos e ordens de fornecimento com saldo calculado por trigger
- [ ] Etapas de fornecimento (11 etapas de 11.3) com prazo, responsável e anexos; kanban no desktop, lista no mobile
- [ ] Financeiro: contratado, empenhado, faturado, recebido, saldo, dias de atraso, retenções
- [ ] Alertas de entrega, vigência, pagamento vencido, regularidade durante execução, reajuste (encaminha ao jurídico)

**Aceite:** saldos corretos com entregas e pagamentos parciais, histórico contratual completo.

### Fase 12 · Dashboard e relatórios · \~45 h

- [ ] Dashboard por permissão com os 13 blocos de 12.1 (KPIs em cards empilhados no mobile)
- [ ] Relatório diário por e-mail após a varredura das 07h00
- [ ] Relatórios comerciais de 12.3 a partir de views materializadas
- [ ] Pesquisa histórica full-text em editais, documentos, produtos, peças e resultados
- [ ] Exportação Excel, PDF e CSV; exportação completa por empresa (CSV/JSON + arquivos em ZIP) para portabilidade

**Aceite:** números do dashboard batem com consultas SQL de conferência, exportação completa reimportável.

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

O plano inteiro soma \~910 h de desenvolvimento, \~1.090 h com 20% de buffer. A 20 h por semana (suposição: estágio + faculdade), o MVP operacional fica pronto em \~16 semanas e a plataforma completa em \~55 semanas.

```text
Onda 1 Fundação (00+01) → Onda 2 MVP (02+03+05) ★ → Onda 3 Captura (04) → Onda 4 Análise (06) → Onda 5 Proposta+jurídico pré (07+08+10.2-10.3) → Onda 6 Disputa+jurídico pós (09+10.4-10.9) → Onda 7 Pós (11+12) → Onda 8 Expansão (13)
```

As ondas rodam em sequência porque o desenvolvimento é solo; cada uma fecha com o relatório de fase do Prompt antes da próxima começar. O MVP é o marco que importa: a partir dele a VV já opera sem a planilha.

### Custo equivalente de desenvolvimento

Referência do projeto: R$ 50/h e US$ 20/h para dev júnior, fórmula horas × taxa + 20% de buffer.

| Recorte | Horas base | Com buffer 20% | BRL | USD |
| --- | --- | --- | --- | --- |
| MVP (Ondas 1 e 2) | 270 h | 324 h | R$ 16.200 | US$ 6.480 |
| V1 (Ondas 1 a 6) | 725 h | 870 h | R$ 43.500 | US$ 17.400 |
| Completo (Ondas 1 a 8) | 910 h | 1.092 h | R$ 54.600 | US$ 21.840 |

Dificuldade geral: **4 de 5**. Não pela stack, que é comum, mas pela soma de multi-tenant com isolamento comprovado, regras jurídicas de prazo e IA com evidência verificável. As Fases 04, 06 e 10 concentram o risco.

### Infraestrutura mensal (valores aproximados, conferir antes de contratar)

| Item | Fase inicial | Com 1º cliente real |
| --- | --- | --- |
| Supabase Pro (prod) | US$ 25 | US$ 25 + compute maior se precisar |
| Supabase PITR (add-on) | não | \~US$ 100 |
| Supabase Branching (homologação) | não | cobrado por hora de branch ativa |
| Vercel | Hobby (grátis) em dev | Pro US$ 20 (uso comercial exige) |
| Railway (worker + ClamAV + LibreOffice) | US$ 5 a 20 | US$ 20 a 40 |
| Backup externo (Cloudflare R2) | \~US$ 1 | \~US$ 2 |
| E-mail transacional (Resend) | grátis | US$ 20 |
| Sentry, Healthchecks.io | grátis | grátis |
| **Total** | **\~US$ 30 a 50** | **\~US$ 190 a 210** |

IA fica fora da conta: com chave VV, o custo por edital depende do provedor e do tamanho do PDF; `ops.llm_execucoes` mede isso desde a Fase 06 para precificar o SaaS. Com BYOK, o custo é do cliente.

## Riscos, dependências e pendências

O maior risco não é técnico: é um prazo jurídico calculado errado ou um ATENDE indevido chegar ao cliente. Por isso prazos, preços e comparações ficam em código puro testado, e a IA nunca tem a palavra final.

| Risco | Tipo | Impacto | Mitigação |
| --- | --- | --- | --- |
| Prazo jurídico calculado errado (feriado municipal faltando) | Produto/legal | Crítico: preclusão | Casos de teste do jurídico VV no CI, data interna D-2, override auditado, feriado ausente gera aviso |
| Vazamento entre empresas por policy RLS errada | Segurança | Crítico | `has_permission()` única, pgTAP A x B obrigatório, CI falha se tabela em `priv` não tiver teste |
| Agente de IA desliga RLS ou usa service role no front | Segurança | Crítico | Regra no `CLAUDE.md`, Semgrep custom bloqueando `service_role` em `apps/web`, revisão humana de toda migration |
| IA marca ATENDE sem evidência | Produto | Alto | Verificador de citação, comparação numérica em código, regra central travada, conjunto de avaliação no CI |
| Minuta com artigo ou acórdão inventado | Legal | Alto | Base jurídica fechada + bloqueio de citação não localizada |
| API do PNCP fora do ar ou mudando contrato | Técnico | Alto | Conector isolado, retry, painel de cobertura, alerta em vez de "zero resultados" |
| Prompt injection em edital | Segurança | Médio | Texto delimitado como dado, modelo sem ferramentas de escrita, saída por schema |
| Custo de IA explodindo com PDFs grandes | Financeiro | Médio | Extrair só o trecho do item, cache por hash de arquivo, limite mensal por empresa |
| JWT no client vulnerável a XSS | Segurança | Médio | CSP estrita, sanitização, JWT curto; reavaliar BFF na virada SaaS |
| Pessoa única como gargalo e ponto de falha | Projeto | Alto | Docs e ADRs em dia, relatório por fase, nada de conhecimento só na cabeça |
| Planilha atual com formato diferente do previsto | Produto | Médio | Importação com mapeamento assistido; ajustar modelo da agenda antes da Fase 05 |
| LGPD sem contrato operador/controlador | Legal | Alto | Bloqueante para o 1º cliente real; jurídico VV redige na Onda 1 |

### Dependências externas

- **Jurídico VV:** tabela de regras de prazo, 30+ casos de teste, base jurídica, revisão de minutas, contrato LGPD.
- **Contador:** parâmetros tributários da Fase 07.
- **Operação VV:** planilha atual, 50 editais da amostra de cobertura, 20 editais de veículos com gabarito para a Fase 06.

### Pendências abertas

- [ ] Enviar a planilha Excel atual de agenda (bloqueia o desenho final da Fase 05)
- [ ] Confirmar dedicação semanal real (o cronograma assume 20 h)
- [ ] Decidir ADR-007: cofre separado para certificado A1 agora ou só quando houver integração que use
- [ ] Definir domínio e identidade visual (nome, logo, cores) para o PWA
- [ ] Confirmar se clientes CLIENTE usam o app no MVP ou só a equipe VV
