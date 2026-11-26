# Produção · como subir e operar o VV Licitações

Passo a passo para colocar o sistema no ar numa VPS (ADR-015) e mantê-lo. Arquivos usados:
[`infra/compose.prod.yml`](../../infra/compose.prod.yml), [`infra/deploy/`](../../infra/deploy/),
[`infra/backup/`](../../infra/backup/README.md), [`.github/workflows/imagens.yml`](../../.github/workflows/imagens.yml)
e o ensaio local [`infra/ensaio/ensaiar-producao.sh`](../../infra/ensaio/ensaiar-producao.sh).

> **Antes do primeiro cliente real** (não só antes de subir): regras de prazo validadas pelo jurídico, contrato
> operador/controlador (LGPD), backup restaurado de verdade (CA-6), homologação separada (ADR-015) e revisão de
> segurança. Subir antes disso vale para a equipe VV usar com dados fictícios ou próprios.

## 1. O que contratar e criar (só o Adriano)

| Item | Para quê | Observação |
| --- | --- | --- |
| VPS em São Paulo, Ubuntu 24.04 LTS, **4 vCPU, 8 GB RAM, 80 GB SSD** | servidor único | o antivírus usa ~1,5 GB e o worker (LibreOffice, OCR) até 2 GB |
| Domínio e registro DNS `A` (e `AAAA`, se houver IPv6) para a VPS | endereço do app e certificado TLS | o Caddy pede o certificado ao Let's Encrypt na subida: o DNS precisa estar valendo antes |
| Bucket S3 dos **documentos**, região no Brasil, privado, versionamento ligado | repositório documental (ADR-017) | duas credenciais: API (ler e gravar) e worker (ler, gravar, listar); CORS do bucket liberando `https://<domínio>` para PUT/GET |
| Bucket S3 de **backup** em **outro provedor**, com versionamento e object lock | backup do banco (pgBackRest) | ver [`infra/backup/README.md`](../../infra/backup/README.md); backup fora do Brasil é transferência internacional (LGPD art. 33) |
| SMTP transacional com STARTTLS (ex.: SES, Resend, Postmark) | e-mails (recuperação, alertas, relatório diário) | domínio do remetente com SPF, DKIM e DMARC |
| Cloudflare Turnstile (site + chave secreta) | CAPTCHA a partir da 3ª falha de login | obrigatório fora de dev (a API não sobe sem) |
| Token do GitHub **só leitura de pacotes** | o servidor baixar as imagens do GHCR | `read:packages`, sem outro escopo |
| Chave de deploy **só leitura** do repositório | o servidor ler `compose` e configuração de backup na tag | GitHub → Settings → Deploy keys, sem escrita |
| Healthchecks.io (opcional, recomendado) | alarme de backup parado, worker e pesquisa sem rodar | uma URL por verificação |
| Cofre de senhas com **duas pessoas** | chave-mestra (KEK) e senha de cifra do backup | perder a KEK = perder segredos cifrados; perder a senha do backup = perder os backups |

Custo de ordem de grandeza: VPS US$ 20–40/mês + S3 e SMTP por uso (ADR-015).

## 2. Ensaiar na sua máquina (antes de contratar)

```bash
infra/ensaio/ensaiar-producao.sh
```

Constrói as cinco imagens, sobe a stack de produção com segredos descartáveis, aplica as migrations, registra a
KEK, espera tudo saudável e confere `/api/health` pelo Caddy com TLS, os cabeçalhos de segurança, o login
recusado, os dotfiles bloqueados e que nenhum segredo está no ambiente dos containers. Depois derruba tudo.
`--manter` deixa no ar em `https://ensaio.vv.test:18443` (acrescente `127.0.0.1 ensaio.vv.test` ao
`/etc/hosts` para abrir no navegador; o certificado é da CA interna do Caddy). Não mexe na stack de
desenvolvimento.

## 3. Primeira subida

1. **Servidor.** Entre por SSH com chave e rode, como root:

   ```bash
   git clone <repositório> /opt/vv          # com a chave de deploy só leitura
   bash /opt/vv/infra/deploy/preparar-servidor.sh
   ```

   Atualizações automáticas, Docker oficial, firewall só com 22/80/443, SSH só por chave, swap e as pastas
   `/opt/vv`, `/etc/vv` e `/etc/vv/segredos` (0700).
2. **Configuração sem segredo:** `cp /opt/vv/infra/deploy/vv.env.example /etc/vv/vv.env`, preencha e
   `chmod 0640 /etc/vv/vv.env`.
3. **Segredos:** `sudo /opt/vv/infra/deploy/gerar-segredos.sh`. Gera as senhas do banco e a KEK e pede as
   credenciais externas sem eco. **Copie a KEK para o cofre** (`sudo cat /etc/vv/segredos/vv_kek`) e nunca a
   guarde junto do backup.
4. **Imagens:** no GitHub, Actions → "Imagens de produção" → Run workflow com a versão (ex.: `2026.11.26-1`).
   O workflow publica `vv-postgres`, `vv-migracoes`, `vv-api`, `vv-worker` e `vv-web` no GHCR e cria a tag no git.
5. **Login no registro** (uma vez): `echo <token só leitura> | docker login ghcr.io -u <usuário> --password-stdin`.
6. **Deploy:** `sudo /opt/vv/infra/deploy/deploy.sh 2026.11.26-1`. O script confere tudo, aplica as migrations,
   registra a KEK no banco novo, sobe, espera ficar saudável e confere `https://<domínio>/api/health`.
7. **Primeiro SUPERADMIN:** `sudo /opt/vv/infra/deploy/criar-superadmin.sh --email <seu e-mail> --nome "<nome>"`.
   A senha inicial aparece uma vez: entre logo e cadastre o autenticador (MFA é obrigatório em produção).
   Use o seu e-mail real aqui, e só aqui: em produção não existe o usuário de teste dos agentes.
8. **Backup:** siga [`infra/backup/README.md`](../../infra/backup/README.md) §"Instalação em produção" com
   `/etc/vv/backup.env` (0400) no lugar de `.env.backup` e, no `/etc/vv/backup-host.env`,
   `VV_COMPOSE=docker compose --project-directory /opt/vv --env-file /etc/vv/vv.env -f /opt/vv/infra/compose.prod.yml -f /opt/vv/infra/backup/compose.backup.yml`.
   Com `/etc/vv/backup.env` presente, o `deploy.sh` liga o arquivamento de WAL e faz um backup completo antes
   de cada migration. **Faça o primeiro ensaio de restauração** (README, "Restaurar") e registre o tempo (RTO).
9. **Conferir:** abrir `https://<domínio>`, entrar, cadastrar MFA, criar a empresa da VV, enviar um documento
   (antivírus e S3), ligar o relatório diário e ver o e-mail chegar.

## 4. Operação do dia a dia

| Tarefa | Como |
| --- | --- |
| Nova versão | Run workflow "Imagens de produção" com a versão nova → `sudo /opt/vv/infra/deploy/deploy.sh <versão>` |
| Voltar uma versão | `sudo /opt/vv/infra/deploy/deploy.sh --voltar` (só as imagens; migrations não voltam) |
| Estado | `sudo /opt/vv/infra/deploy/deploy.sh --status` |
| Logs | `docker compose --project-directory /opt/vv --env-file /etc/vv/vv.env -f /opt/vv/infra/compose.prod.yml logs --tail 200 api worker` (sem segredo: o Caddy tira cookies e tokens) |
| Backup e restauração | [`infra/backup/README.md`](../../infra/backup/README.md); ensaio de restauração a cada trimestre |

**Migrations compatíveis com a versão anterior.** O `deploy.sh` volta as imagens sozinho se algo falhar depois
das migrations, mas o banco fica na versão nova. Por isso toda migration precisa funcionar com o código da
versão anterior (expandir antes, contrair depois): adicionar coluna/tabela/função numa versão; parar de usar
na seguinte; remover só na outra. Migration destrutiva exige backup completo conferido antes (o `deploy.sh` faz,
com o backup ligado) e janela combinada.

## 5. Trocar um segredo (rotação)

1. Senha de papel do banco (`vv_api`, `vv_worker`, `vv_owner`): `alter role ... password '<nova>'` como
   `postgres`, regrave **os dois** arquivos (`vv_api_password` e `vv_api_database_url`, por exemplo) e
   `deploy.sh <versão atual>` para reiniciar.
2. Credenciais externas (S3, SMTP, Turnstile): gere a nova no provedor, regrave o arquivo (0444), reinicie com
   `deploy.sh <versão atual>` e só então revogue a antiga.
3. KEK: exige procedimento próprio (nova versão no banco com `registrar-kek.sh <versão>`, recifrar os segredos);
   **guarde as KEKs antigas** enquanto houver backup que dependa delas (ADR-017). Não está automatizado.

## 6. O que ainda não está pronto para produção

- **Sentry** (erros da API, do worker e do front): precisa da conta e de dependência nova (AGENTS.md §9).
- **Homologação** separada: ADR-015 a exige antes do 1º cliente real.
- **Monitoramento do arquivamento de WAL e do disco** (README do backup, item 7): alerta ainda manual.
- **Rotação da KEK** automatizada.
- **CI** como gate do deploy: hoje o workflow de imagens não exige o CI verde (modo rápido, AGENTS.md §0).
