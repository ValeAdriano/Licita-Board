# Front (build do Vite) + Caddy (TLS, cabeçalhos de segurança, /api para a API). Contexto: a raiz do repositório.
FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web ./
RUN npm run build

FROM caddy:2.10
COPY --from=build /app/dist /srv/web
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
