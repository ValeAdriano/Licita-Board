// Projeto VV Licitações no Railway (ADR-022). Aplicar com infra/railway/subir.sh.
// Segredos nunca entram aqui: preserve() mantém o valor que já está no Railway.
// ctx.randomString() NÃO serve para senha: é um hash previsível do nome do ambiente.
import { defineRailway, github, image, preserve, project, service, volume } from "railway/iac";

const REPO = "ValeAdriano/Licita-Board";
// Produção publica só deste branch: push no main não toca o servidor. Publicar: git push origin main:producao
const RAMO = "producao";
const fonte = (rootDirectory?: string) => github(REPO, { branch: RAMO, ...(rootDirectory ? { rootDirectory } : {}) });
const docker = (dockerfilePath: string) => ({ builder: "DOCKERFILE" as const, dockerfilePath });
const PUBLICO = "https://${{web.RAILWAY_PUBLIC_DOMAIN}}";

// Iguais aos que o Railway criou: sem eles o apply tentaria apagar região e tamanho do volume.
const VOLUME = { region: "us-east4-eqdc4a", sizeMB: 5000 };

export default defineRailway(() => {
  const pgdata = volume("pgdata", VOLUME);
  const clamdata = volume("clamdata", VOLUME);

  const postgres = service("postgres", {
    source: fonte("db"),
    build: docker("Dockerfile"),
    env: {
      // Subpasta: a raiz do volume tem lost+found e o initdb recusa.
      PGDATA: "/var/lib/postgresql/data/pgdata",
      POSTGRES_INITDB_ARGS: "--data-checksums",
      VV_DB: "vv",
      POSTGRES_PASSWORD: preserve(),
      VV_OWNER_PASSWORD: preserve(),
      VV_API_PASSWORD: preserve(),
      VV_WORKER_PASSWORD: preserve(),
    },
    volumeMounts: { "/var/lib/postgresql/data": pgdata },
  });

  // Roda uma vez a cada push: migrations, verificador da KEK e (opcional) o primeiro SUPERADMIN.
  const migracoes = service("migracoes", {
    source: fonte(),
    build: docker("infra/railway/migracoes.Dockerfile"),
    deploy: { restartPolicyType: "NEVER" },
    env: {
      VV_DB_HOST: "postgres.railway.internal",
      VV_OWNER_PASSWORD: "${{postgres.VV_OWNER_PASSWORD}}",
      VV_KEK: "${{api.VV_KEK}}",
      VV_SUPERADMIN_EMAIL: preserve(),
      VV_NOVA_SENHA: preserve(),
    },
  });

  const api = service("api", {
    source: fonte("apps/api"),
    build: docker("Dockerfile"),
    healthcheck: "/health",
    env: {
      NODE_ENV: "production",
      VV_ENV: "prod",
      PORT: "3000",
      DATABASE_URL: "postgres://vv_api:${{postgres.VV_API_PASSWORD}}@postgres.railway.internal:5432/vv?sslmode=disable",
      CORS_ORIGINS: PUBLICO,
      // A API não tem domínio público: só a rede privada (onde está o Caddy) chega nela.
      TRUST_PROXY: "10.0.0.0/8,100.64.0.0/10,172.16.0.0/12,192.168.0.0/16,fd00::/8",
      CADASTRO_ABERTO: "false",
      VV_KEK: preserve(),
      TURNSTILE_SECRET: preserve(),
      S3_ENDPOINT: preserve(),
      S3_PUBLIC_URL: "${{api.S3_ENDPOINT}}",
      S3_BUCKET: preserve(),
      S3_ACCESS_KEY: preserve(),
      S3_SECRET_KEY: preserve(),
      VAPID_PUBLIC_KEY: preserve(),
    },
  });

  const clamav = service("clamav", {
    // Fixada por digest (stable em 2026-11-26); as assinaturas continuam atualizando pelo freshclam.
    source: image("clamav/clamav-debian@sha256:85f35b3eee903dbd96c5ca250c5aa13d230d97987c0f876f7d46f001f9414239"),
    volumeMounts: { "/var/lib/clamav": clamdata },
  });

  const worker = service("worker", {
    source: fonte("apps/worker"),
    build: docker("Dockerfile"),
    healthcheck: "/health",
    env: {
      PORT: "8000",
      VV_ENV: "prod",
      VV_FILA_ATIVA: "true",
      VV_DATABASE_URL: "postgresql://vv_worker:${{postgres.VV_WORKER_PASSWORD}}@postgres.railway.internal:5432/vv",
      VV_KEK: "${{api.VV_KEK}}",
      VV_S3_ENDPOINT: "${{api.S3_ENDPOINT}}",
      VV_S3_BUCKET: "${{api.S3_BUCKET}}",
      // Chave própria, com mais alcance que a da API (quarentena -> documentos).
      VV_S3_ACCESS_KEY: preserve(),
      VV_S3_SECRET_KEY: preserve(),
      VV_CLAMAV_HOST: "clamav.railway.internal",
      VV_APP_URL: PUBLICO,
      VV_SMTP_HOST: preserve(),
      VV_SMTP_PORT: "587",
      VV_SMTP_STARTTLS: "true",
      VV_SMTP_USUARIO: preserve(),
      VV_SMTP_SENHA: preserve(),
      VV_EMAIL_REMETENTE: preserve(),
      VV_VAPID_PUBLIC_KEY: "${{api.VAPID_PUBLIC_KEY}}",
      VV_VAPID_PRIVATE_KEY: preserve(),
      VV_VAPID_CONTATO: PUBLICO,
      VV_ANTHROPIC_API_KEY: preserve(),
    },
  });

  // Única porta pública: front + Caddy (cabeçalhos de segurança e /api). O TLS é do Railway.
  const web = service("web", {
    source: fonte(),
    build: docker("infra/railway/web.Dockerfile"),
    healthcheck: "/",
    env: {
      PORT: "8080",
      VV_SITE: ":8080",
      VV_API_UPSTREAM: "api.railway.internal:3000",
      VV_CSP_CONNECT_EXTRA: "${{api.S3_ENDPOINT}}",
      VITE_VV_ENV: "prod",
      VITE_CADASTRO_ABERTO: "false",
      VITE_TURNSTILE_SITEKEY: preserve(),
    },
  });

  return project("vv-licitacoes", { resources: [pgdata, clamdata, postgres, migracoes, api, clamav, worker, web] });
});
