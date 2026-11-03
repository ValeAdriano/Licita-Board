import psycopg
from fastapi import FastAPI, Response, status

from worker.logging import configure_logging
from worker.settings import Settings

settings = Settings()
configure_logging(settings.log_level)

# Só health check para o Docker/Caddy. Jobs chegam pela fila ops.jobs (ADR-014), nunca por HTTP.
app = FastAPI(title="vv-worker", docs_url=None, redoc_url=None, openapi_url=None)


def banco_ok(url: str) -> bool:
    if not url:
        return False
    try:
        with psycopg.connect(url, connect_timeout=3) as conn:
            conn.execute("select 1")
    except psycopg.Error:
        return False
    return True


@app.get("/health")
def health(response: Response) -> dict[str, str]:
    if not banco_ok(settings.database_url.get_secret_value()):
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "erro", "banco": "indisponivel"}
    return {"status": "ok", "banco": "ok", "env": settings.env}
