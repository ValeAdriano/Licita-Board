# Front + Caddy no Railway (ADR-022). Contexto: a raiz do repositório.
# Difere de infra/caddy/Dockerfile em duas coisas: passa as VITE_* para o build e, atrás da borda do
# Railway, usa o X-Real-IP (escrito pela borda) como IP do cliente em vez do IP da própria borda.
FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web ./
ARG VITE_VV_ENV
ARG VITE_CADASTRO_ABERTO
ARG VITE_TURNSTILE_SITEKEY
RUN npm run build

FROM caddy:2.10
COPY --from=build /app/dist /srv/web
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
RUN sed -i 's/^\([[:space:]]*\)header_up -X-Real-IP$/\1header_up X-Forwarded-For {http.request.header.X-Real-IP}\n&/' /etc/caddy/Caddyfile \
 && grep -q 'header_up X-Forwarded-For {http.request.header.X-Real-IP}' /etc/caddy/Caddyfile
