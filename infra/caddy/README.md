# Caddy: porta de entrada

`Caddyfile` serve o front (`apps/web/dist`), repassa `/api` para a API e aplica TLS e os cabeçalhos de segurança da política de [`apps/web/AGENTS.md`](../../apps/web/AGENTS.md). Ameaças: T5.18, T5.35 a T5.37 em [`docs/threat-model.md`](../../docs/threat-model.md).

## Variáveis

| Variável | Padrão | Uso |
| --- | --- | --- |
| `VV_SITE` | `localhost` | Endereço do site. Produção: o domínio (TLS automático). Teste: `http://:8080` |
| `VV_WEB_ROOT` | `/srv/web` | Pasta do build do front |
| `VV_API_UPSTREAM` | `api:3000` | API na rede interna |

## O que o teste garante (`testar-cabecalhos.sh`, job `caddy` do CI)

Cabeçalhos em todas as respostas (inclusive `/api` e `/sw.js`) com uma só ocorrência e valor do Caddy; cache (`no-cache` no app, `immutable` só em asset que existe, `no-store` da API, sem rede de segurança no Caddy); `sw.js`, `push.js` e o manifesto são os do build; 404 para asset, arquivo e dotfile inexistentes (nunca o `index.html` no lugar); `/api` com e sem barra vai para a API; `X-Forwarded-For` é escrito pelo Caddy e os forjados (`X-Real-IP`, `Forwarded`, `X-Forwarded-Host`) não chegam; corpo acima de 256 KB é recusado; o log de acesso existe e não traz cookie, token CSRF, `Authorization` nem `Set-Cookie`.

Roda só em Linux (`--network host`). Para rodar na mão: `npm run build --prefix apps/web && infra/caddy/testar-cabecalhos.sh`.

## Pendente (compose de produção, Fase 00)

- Serviço do Caddy no compose, com `TRUST_PROXY` da API igual ao CIDR fixo do Caddy e um smoke de deploy que compara o IP visto pela API com o do cliente (T5.36).
- Rotação do log de acesso (`logging: max-size`) e a retenção no `docs/lgpd.md` (T5.37).
- Fixar a imagem por digest.
- Validar a CSP em homologação com `Content-Security-Policy-Report-Only` antes da primeira liberação.
