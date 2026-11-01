from fastapi import FastAPI

from worker.logging import configure_logging
from worker.settings import Settings

settings = Settings()
configure_logging(settings.log_level)

# Só health check para o Railway. Jobs chegam pela fila pgmq, nunca por HTTP do front.
app = FastAPI(title="vv-worker", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "env": settings.env}
