# Spec · Fase 00 · Fundação técnica, ambientes e modelo de ameaças

- **Status:** Em revisão (revisão 2: stack nova, ADR-011 a 017 aceitas em 2026-11-02)
- **Onda:** 1 — Fundação
- **Autor:** Claude Code · **Aprovação:** pendente (Adriano Vale)
- **Validação jurídica:** n/a
- **Fontes:** Prompt Mestre Fase 00; Plano (revisão 2), Fase 00; ADR-005 a 008 e ADR-011 a 017

## 1. Escopo

**Entra:** monorepo, regras para agentes, ADRs, modelo de ameaças, Docker Compose de desenvolvimento (Postgres, API, worker), fundação do banco (papéis, schemas, contexto do usuário, guarda pgTAP), esqueletos da API NestJS, do app Expo e do worker com `/health`, CI (lint, typecheck, testes, pgTAP, e2e, imagens, SAST, segredos, dependências), guardas (Semgrep e hook), faixa de ambiente, observabilidade básica, produção vazia numa VPS.

**Não entra:** tabelas de negócio, autenticação, telas além da inicial (Fase 01).

## 2. Requisitos

| ID | Requisito | Origem | Situação |
| --- | --- | --- | --- |
| RF-00.1 | `docs/adr` com as decisões de stack, auth, multi-tenant, fila, IA, documentos, cofre, busca, ambientes, app e arquivos | Prompt 0.1 | feito (011–017 aceitas; 005–008 propostas) |
| RF-00.2 | Ambientes identificados; faixa colorida fora de prod | Prompt 0.2 | dev feito (faixa no app); homologação adiada (ADR-015) |
| RF-00.3 | Modelo de ameaças com as 7 ameaças, controle e teste | Prompt 0.3 | feito na revisão 1; **revisar para API própria** (contexto forjável por SQLi, RCE na API, VPS única) |
| RF-00.4 | Git com `main` protegido | Prompt 0.4 | pendente (Adriano optou por push direto no `main` enquanto trabalha sozinho) |
| RF-00.5 | CI: lint, testes, SAST, dependências, segredos | Prompt 0.4 | feito (jobs API + banco, Web, Worker, Guardas) |
| RF-00.6 | Migrations versionadas e reversíveis | Prompt 0.4 | feito: dbmate, CI roda up → rollback → up |
| RF-00.7 | Cobertura ≥ 80% em permissão, preço, prazos, análise | Prompt 0.4 | regra definida; aplicada quando os módulos existirem |
| RF-00.8 | Logs estruturados sem dados sensíveis | Prompt 0.5 | feito: pino na API (sem cookie/authorization), JSON no worker |
| RF-00.9 | Rastreamento de erros e monitoramento do agendador | Prompt 0.5 | pendente (Sentry, Healthchecks.io) |
| RF-00.10 | Regras para agentes (`AGENTS.md`, `CLAUDE.md`, `db/AGENTS.md`, `apps/web/AGENTS.md`, hooks) | Plano | feito |
| RF-00.11 | `docker compose up` sobe Postgres, API e worker com healthcheck | ADR-015 | feito no código; **não executado** (Docker não instalado na máquina de dev) |
| RF-00.12 | Papéis `vv_owner`/`vv_api`/`vv_worker` e contexto do usuário preso à transação | ADR-013 | feito (`db/tests/001`, `002`) |
| RF-00.13 | Front chamando `/api/health` | ADR-018 (antes: app Expo, ADR-016) | feito no front React web; apps nativos adiados |
| RF-00.14 | Produção vazia: VPS, Caddy (TLS), `infra/compose.prod.yml`, deploy pelo pipeline | ADR-015 | pendente (escolha da VPS) |

## 3. Tarefas restantes

**Do Adriano:**
1. Instalar Docker (Docker Desktop ou OrbStack) e rodar `scripts/dev-env.sh` + `docker compose up -d --build` + `docker compose run --rm dbmate up`.
2. Escolher VPS em São Paulo e provedor S3 de produção (ADR-015, ADR-017).
3. Criar Sentry e Healthchecks.io; guardar DSN/URLs como segredos do servidor.
4. Decidir ADR-007 e aceitar o modelo de ameaças revisado.
5. Decidir o destino do projeto Supabase da revisão 1.

**Dos agentes:**
1. Revisar `docs/threat-model.md` para a stack nova (T5 sessão, T1 contexto, servidor único).
2. `infra/`: `compose.prod.yml`, Caddyfile, script de deploy e de backup (WAL), assim que houver VPS.
3. Sentry na API, no worker e no app.

## 4. Critérios de aceite

| # | Critério | Como será comprovado |
| --- | --- | --- |
| CA-1 | CI verde no `main` | link do run |
| CA-2 | Stack local sobe e o app mostra "API conectada" | print do app web + `docker compose ps` saudável |
| CA-3 | Deploy automático funcionando | URL de produção sem faixa; `/health` respondendo |
| CA-4 | ADRs e modelo de ameaças aprovados | status `Aceito`/`Aprovado` |
| CA-5 | Guardas funcionando | Semgrep e hook barrando credencial no app/API e RLS desligado (testes em `.claude/hooks/tests`) |

## 5. Perguntas abertas

1. **ADR-007** — adiar cofre de A1/senhas de portal? Recomendação: sim, até haver integração que use.
2. **Dedicação semanal** — o cronograma assume 20 h. Confirmar.
3. **CLIENTE no MVP** — clientes usam o app no MVP ou só a equipe VV?
4. **Domínio e identidade visual** — nome, logo, cores e ícone do app.
5. **`main` protegido** — manter push direto enquanto só você trabalha, ou exigir PR + CI verde? Recomendação: exigir CI verde (`ci-ok`) mesmo com push direto, quando o GitHub permitir.
