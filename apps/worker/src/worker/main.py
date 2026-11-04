import threading
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import psycopg
from fastapi import FastAPI, Response, status

from worker import fila
from worker.email import EnviadorSmtp
from worker.fila import consumir
from worker.logging import configure_logging
from worker.push import EnviadorWebPush
from worker.settings import Settings

settings = Settings()
configure_logging(settings.log_level)


@asynccontextmanager
async def ciclo(_app: FastAPI) -> AsyncIterator[None]:
    # O consumidor da fila roda numa thread ao lado do health check (VV_FILA_ATIVA).
    parar = threading.Event()
    if settings.fila_ativa:
        push = EnviadorWebPush(settings) if settings.vapid_private_key.get_secret_value() else None
        for pesado in (False, True):  # jobs curtos + agendador / jobs longos da pesquisa
            threading.Thread(
                target=consumir,
                args=(settings, EnviadorSmtp(settings), parar, push, pesado),
                daemon=True,
            ).start()
    yield
    parar.set()


# Só health check para o Docker/Caddy. Jobs chegam pela fila ops.jobs (ADR-014), nunca por HTTP.
app = FastAPI(title="vv-worker", docs_url=None, redoc_url=None, openapi_url=None, lifespan=ciclo)


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
    # Fila ligada e consumidor sem ciclo há mais de 90 s = worker parado (T7.2).
    fila_parada = settings.fila_ativa and time.monotonic() - fila.ultimo_ciclo > 90
    if fila_parada or not banco_ok(settings.database_url.get_secret_value()):
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "erro", "banco": "indisponivel"}
    return {"status": "ok", "banco": "ok", "env": settings.env}
