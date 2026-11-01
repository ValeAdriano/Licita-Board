# Spec · Fase 00 · Fundação técnica, ambientes e modelo de ameaças

- **Status:** Em revisão
- **Onda:** 1 — Fundação
- **Autor:** Claude Code · **Aprovação:** pendente (Adriano Vale)
- **Validação jurídica:** n/a
- **Fontes:** Prompt Mestre Fase 00; Plano, Fase 00; ADR-001 a ADR-010

## 1. Escopo

**Entra:** monorepo, regras para agentes, ADRs iniciais, modelo de ameaças, CI (lint, typecheck, testes, pgTAP, SAST, segredos, dependências), Supabase local, faixa de ambiente, observabilidade básica, deploys vazios.

**Não entra:** qualquer tabela de negócio, autenticação funcional, telas (Fase 01).

## 2. Requisitos

| ID | Requisito | Origem | Situação |
| --- | --- | --- | --- |
| RF-00.1 | Pasta `docs/adr` com ADRs de stack, auth, multi-tenant, fila, IA, documentos, cofre, busca, ambientes, PWA | Prompt 0.1 | feito (status Proposto) |
| RF-00.2 | Ambientes identificados; faixa colorida fora de prod | Prompt 0.2 | dev feito; homologação adiada (ADR-009) |
| RF-00.3 | Modelo de ameaças com as 7 ameaças, controle e teste | Prompt 0.3 | feito (+T8) |
| RF-00.4 | Git com `main` protegido, toda mudança por PR | Prompt 0.4 | pendente (configurar no GitHub) |
| RF-00.5 | CI: lint, testes, SAST, dependências, segredos | Prompt 0.4 | feito (`.github/workflows/ci.yml`) |
| RF-00.6 | Migrations versionadas e reversíveis | Prompt 0.4 | convenção em `supabase/AGENTS.md` |
| RF-00.7 | Cobertura ≥ 80% em permissão, preço, prazos, análise | Prompt 0.4 | regra definida; aplicada quando os módulos existirem |
| RF-00.8 | Logs estruturados sem dados sensíveis | Prompt 0.5 | feito no worker (`worker.logging`) |
| RF-00.9 | Rastreamento de erros e monitoramento do agendador | Prompt 0.5 | pendente (Sentry, Healthchecks.io) |
| RF-00.10 | Regras para agentes (`AGENTS.md`, `CLAUDE.md`, prompts, hooks) | Plano | feito |
| RF-00.11 | Deploy vazio: Vercel (front) e Railway (worker) | Plano | pendente (contas) |

## 3. Tarefas restantes que dependem do Adriano

1. Criar projeto Supabase Pro de produção (região São Paulo, `sa-east-1`) e ativar leaked password protection, MFA TOTP, time-box 12 h, inatividade 30 min, CAPTCHA do Auth.
2. Proteger `main` no GitHub: PR obrigatório, CI obrigatório (`ci-ok`), sem force push.
3. Conectar Vercel (raiz `apps/web`, `VITE_ENV=prod` só em Production) e Railway (raiz `apps/worker`, Dockerfile).
4. Criar Sentry (front + worker) e Healthchecks.io; guardar DSN/URLs como segredos.
5. Revisar e aceitar ADR-001…010 (decidir ADR-007) e o modelo de ameaças.

## 4. Critérios de aceite

| # | Critério | Como será comprovado |
| --- | --- | --- |
| CA-1 | CI verde no `main` protegido | link do run + print da regra de proteção |
| CA-2 | Deploy automático funcionando | URL da Vercel com faixa ausente em prod; `/health` do Railway |
| CA-3 | ADRs aprovados | status `Aceito` em `docs/adr/README.md` |
| CA-4 | Modelo de ameaças aprovado | status `Aprovado` em `docs/threat-model.md` |
| CA-5 | Guardas funcionando | CI falha em PR de teste com service role no front e com tabela `priv` sem teste |

## 5. Perguntas abertas

1. **ADR-007** — adiar cofre de A1/senhas de portal? Recomendação: sim, até haver integração que use.
2. **Dedicação semanal** — o cronograma assume 20 h. Confirmar.
3. **CLIENTE no MVP** — clientes usam o app no MVP ou só a equipe VV? Afeta prioridade de telas de leitura na Onda 2.
4. **Domínio e identidade visual** — nome, logo e cores do PWA.
