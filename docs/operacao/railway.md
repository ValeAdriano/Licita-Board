# Subir no Railway (ADR-022)

## Estado (2026-11-26)
Projeto `vv-licitacoes`, front em https://web-production-5d333571.up.railway.app. `postgres`, `migracoes`, `clamav` e `web` no ar; senhas e `VV_KEK` já geradas. `api` e `worker` não sobem até preencher Turnstile e SMTP: rode `infra/railway/subir.sh` num terminal (ele só pergunta o que falta).

## Antes
1. Plano **Pro** (SMTP só existe nele; o ClamAV pede ~3 GB de RAM).
2. Cloudflare Turnstile (chave do site e secreta), um bucket S3/R2 com par de chaves, um SMTP.
3. `npm i -g @railway/cli && railway login`; no painel, dar ao Railway acesso ao repositório `ValeAdriano/Licita-Board`.

## Subir
```bash
infra/railway/subir.sh
```
Cria o projeto, aplica `.railway/railway.ts`, gera as senhas e a `VV_KEK`, pede os dados externos, gera o domínio e publica. Pode rodar de novo. Depois disso, **push no `main` publica**.

## Depois (à mão)
- CORS do bucket: PUT e GET para o endereço do serviço `web`.
- Turnstile: adicionar o domínio.
- `VV_KEK` num cofre; apagar `VV_NOVA_SENHA` do serviço `migracoes`.
- Backup do volume do `postgres`.
- **Não** gerar domínio público para `api`, `worker`, `postgres` ou `clamav`.

## Domínio próprio
Adicionar no serviço `web` e trocar `PUBLICO` em `.railway/railway.ts`; refazer CORS e Turnstile.

## Se falhar
- `migracoes` com erro: `api` sobe mas as telas falham; ver o log dele e fazer redeploy.
- Conferir: `https://<domínio>/api/health` deve responder `{"status":"ok","banco":"ok",...}`.
- Voltar versão: painel > serviço > Deployments > redeploy do anterior (migrations não voltam).
