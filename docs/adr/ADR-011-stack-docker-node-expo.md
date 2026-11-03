# ADR-011 · Stack: Docker Compose, Postgres 17, API NestJS, app Expo, worker Python, VPS

- **Status:** Aceito (2026-11-02)
- **Data:** 2026-11-02
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre, "Padrão técnico" (arquitetura sugerida), 0.1, 1.4
- **Substitui:** ADR-001

## Contexto

A revisão 1 (ADR-001) usava Supabase, Vite SPA e Vercel. Ela deixava dois desvios de segurança em aberto: bcrypt custo 10 e JWT no client sem cookie HttpOnly. Também prendia auth, storage e fila a um fornecedor. O Adriano decidiu, em 2026-11-02, rodar tudo em Docker com Postgres próprio, backend em Node e front em React Native. O app precisa continuar acessível pelo navegador (Prompt: uso no computador e no celular).

## Alternativas

| Alternativa | Prós | Contras | Custo mensal estimado |
| --- | --- | --- | --- |
| A. Manter a revisão 1 (Supabase + Vite) | Pronto, menos código | Desvios de auth; dependência de fornecedor; não é o que o dono quer | US$ 30–50 |
| B. **Docker Compose: Postgres 17 + API NestJS + app Expo (iOS/Android/Web) + worker Python, numa VPS** | Isolamento em duas camadas como o Prompt pede; auth à risca; mesmo artefato em todos os ambientes; app nativo | Mais código próprio (auth, storage, fila, operação do servidor) | US$ 30–55 |
| C. Igual a B, mas com Fastify em vez de NestJS | Mais leve | Menos convenção para os agentes; guards e módulos feitos à mão | igual |
| D. Igual a B, mas com o worker reescrito em Node | Uma linguagem só | Ecossistema de PDF/OCR/IA e `Decimal` mais fraco; reescreve código pronto | igual |

## Decisão

**B.**

- **Banco:** PostgreSQL 17 em imagem própria (`db/Dockerfile`: oficial + pgTAP + pgvector). Migrations em SQL puro com **dbmate** (binário único, `-- migrate:up` / `-- migrate:down`). Consultas da API com **Kysely**, tipos gerados por `kysely-codegen`.
- **API:** **NestJS** (Node 26 LTS, TypeScript estrito), Zod nas bordas, pino para logs JSON.
- **App:** **Expo** (React Native + TS) com Expo Router e react-native-web: um código para iOS, Android e Web (ADR-016).
- **Worker:** Python 3.12 (o atual), consumindo `ops.jobs` (ADR-014).
- **Arquivos:** S3 compatível, MinIO no Docker local (ADR-017).
- **Produção:** uma VPS em São Paulo com Docker Compose, Caddy na frente (TLS automático), imagens publicadas no GHCR pelo CI. A escolha do provedor da VPS fica pendente.

## Consequências

- **Positivas:** Prompt 1.4 atendido sem os desvios de auth; dev = homologação = produção em Docker; RLS e pgTAP da Fase 01 reaproveitados; sem lock-in de fornecedor.
- **Negativas / risco residual:** passamos a operar o servidor (atualizações, firewall, backup) e a escrever auth própria, que é código crítico (mitigação: bibliotecas maduras, testes de ataque, revisão de segurança, pentest antes do 1º cliente real). Duas linguagens no repositório (TS e Python).
- **Desvio do Prompt Mestre:** Next.js → Expo (mesmo React + TS, com app nativo). FastAPI → NestJS na API; FastAPI fica só no worker. Postgres com RLS, S3 e filas permanecem.
- **Gatilho para reavaliar:** mais de \~50 empresas ou SLA contratual que exija alta disponibilidade (avaliar Postgres gerenciado e mais de um nó de API).
