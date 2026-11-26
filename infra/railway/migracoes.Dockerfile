# Passo de preparo do banco no Railway (ADR-022): migrations, KEK e primeiro SUPERADMIN. Roda e sai.
# Contexto: a raiz do repositório. Só este serviço recebe a senha de vv_owner.
FROM ghcr.io/amacneil/dbmate:2.37.0 AS dbmate

FROM node:26-bookworm-slim
WORKDIR /app
COPY --from=dbmate /usr/local/bin/dbmate /usr/local/bin/dbmate
COPY apps/api/package.json apps/api/package-lock.json apps/api/
RUN npm ci --omit=dev --prefix apps/api
COPY db/migrations db/migrations
COPY scripts/criar-usuario.mjs scripts/
COPY infra/railway/preparar.mjs infra/railway/
USER node
CMD ["node", "infra/railway/preparar.mjs"]
