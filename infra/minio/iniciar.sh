#!/bin/sh
# Cria o bucket privado e DUAS credenciais de menor privilégio (ADR-017): a API só grava em quarentena/
# e lê documentos/; o worker verifica e move. Roda uma vez por subida (idempotente).
set -eu
until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do sleep 1; done
mc mb --ignore-existing local/vv-docs
mc admin policy create local vv-api /politicas/politica-api.json 2>/dev/null || mc admin policy create local vv-api /politicas/politica-api.json
mc admin policy create local vv-worker /politicas/politica-worker.json 2>/dev/null || true
mc admin user add local "$S3_API_ACCESS_KEY" "$S3_API_SECRET_KEY" 2>/dev/null || true
mc admin user add local "$S3_WORKER_ACCESS_KEY" "$S3_WORKER_SECRET_KEY" 2>/dev/null || true
mc admin policy attach local vv-api --user "$S3_API_ACCESS_KEY" 2>/dev/null || true
mc admin policy attach local vv-worker --user "$S3_WORKER_ACCESS_KEY" 2>/dev/null || true
echo "MinIO pronto."
