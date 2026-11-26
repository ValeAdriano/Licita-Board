# ADR-022 · Hospedagem no Railway

- **Status:** Aceito (2026-11-26); publicação só pelo branch `producao`
- **Data:** 2026-11-26
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 0.2, 0.5

## Contexto

O Adriano quer publicar pelo Railway, ligando o repositório. A ADR-015 previa VPS com Compose; os arquivos dela continuam válidos e não mudaram.

## Alternativas

| Alternativa | Prós | Contras | Custo mensal estimado |
| --- | --- | --- | --- |
| A. Railway com `.railway/railway.ts` | Push no `main` publica; sem servidor para cuidar | Sem pgBackRest/PITR; ClamAV pede ~3 GB de RAM; SMTP só no Pro | Pro + uso (não medido) |
| B. VPS (ADR-015) | Backup e rede já prontos | Servidor para operar | US$ 20–40 |

## Decisão

**A.** Um projeto com `postgres` (imagem de `db/`, volume), `migracoes` (roda e sai), `api`, `worker`, `clamav` e `web` (Caddy, única porta pública). S3 externo (o código usa URL em path-style e precisa de CORS). `infra/railway/subir.sh` cria tudo e gera os segredos.

## Consequências

- **Positivas:** mesmas imagens e mesmos papéis do banco; só `migracoes` e `postgres` conhecem `vv_owner`.
- **Negativas / risco residual:** segredos viram variáveis de ambiente no Railway (não Docker secrets), visíveis no painel; a API confia em `X-Forwarded-For` de qualquer faixa privada (ela não tem domínio público: **nunca gerar um**); o IP do cliente vem do `X-Real-IP` escrito pela borda do Railway; banco sem TLS na rede privada; a rede privada é plana (`web` e `clamav` alcançam banco e API); sem backup antes das migrations.
- **Desvio do Prompt Mestre:** backup/PITR e restauração testada ficam pendentes (hoje só o backup de volume do Railway); região fora do Brasil, a avaliar (LGPD) antes de dado real.
- **Gatilho para reavaliar:** primeiro dado real de cliente.
