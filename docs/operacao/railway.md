# Subir no Railway (ADR-022)

## Estado (2026-11-26)
Sistema no ar em https://web-production-5d333571.up.railway.app (projeto `vv-licitacoes`, branch `producao`): os 6 serviços implantados, `/api/health` ok, primeiro SUPERADMIN criado. **Pendente:** Turnstile e SMTP reais (provisórios, abaixo), S3 (documentos desligados), backup do volume, cópia da `VV_KEK` num cofre, conferir se a borda sobrescreve `X-Real-IP`.

## Valores provisórios (trocar)
`api.TURNSTILE_SECRET` e `worker.VV_SMTP_*` estão com valores provisórios: o CAPTCHA sempre falha (após 3 erros de senha em 15 min, o login daquele e-mail/IP fica bloqueado) e **nenhum e-mail sai** (recuperação de senha, convites, alertas de prazo). Não usar com prazo real. O `subir.sh` pergunta de novo por eles. Ao configurar o Turnstile, definir também `web.VITE_TURNSTILE_SITEKEY`.

## Cadastro aberto (decisão do Adriano, 2026-11-26)
Qualquer pessoa cria conta e empresa em `/cadastrar` (nunca SUPERADMIN; MFA no primeiro acesso). Sem prova de posse do CNPJ, e-mail não verificado, sem CAPTCHA no cadastro (só 20 pedidos/min por IP). Para fechar: em `.railway/railway.ts` pôr o `startCommand` do `postgres` em `"docker-entrypoint.sh postgres"` (não apague a linha), `CADASTRO_ABERTO` e `VITE_CADASTRO_ABERTO` em `"false"`, `railway config apply` e conferir o redeploy de `postgres`, `api` e `web`. Sem S3, o passo "Enviar documentos" dos Primeiros passos não conclui; sem SMTP, quem esquecer a senha não recupera. Fechar não apaga contas já criadas.

**Com o cadastro aberto, não defina `worker.VV_ANTHROPIC_API_KEY`:** empresa sem chave própria usa a global, e qualquer estranho gastaria na sua conta.

## Antes
1. Plano **Pro** (SMTP só existe nele; o ClamAV pede ~3 GB de RAM).
2. Cloudflare Turnstile (chave do site e secreta), um bucket S3/R2 com par de chaves, um SMTP.
3. `npm i -g @railway/cli && railway login`; no painel, dar ao Railway acesso ao repositório `ValeAdriano/Licita-Board`.

## Publicar
O Railway publica **só do branch `producao`**; push no `main` não toca o servidor.
```bash
git push origin main:producao
```

## Subir ou completar a configuração
```bash
railway link                 # ou: railway init --name vv-licitacoes (projeto novo)
infra/railway/subir.sh
```
Mostra o plano, aplica `.railway/railway.ts`, gera as senhas e a `VV_KEK`, pede os dados externos, gera o domínio e publica. Pode rodar de novo. Nunca sobrescreve valor existente; se não conseguir ler as variáveis, para. Não há backup automático antes das migrations.

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
