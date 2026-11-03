import hashlib
import logging
import secrets
import threading
import time
from collections.abc import Callable
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.email import Enviador, mensagem_alerta, mensagem_recuperacao
from worker.settings import Settings

log = logging.getLogger("worker.fila")

# Último ciclo do consumidor (monotônico); o /health acusa fila parada (T7.2).
ultimo_ciclo: float = 0.0

Job = dict[str, Any]
Handler = Callable[[psycopg.Connection[Any], Job], None]


class Handlers:
    """Um método por tipo de job. Payload só traz IDs; dado sensível nunca entra no log."""

    def __init__(self, settings: Settings, enviador: Enviador) -> None:
        self._s = settings
        self._enviador = enviador

    def tipos(self) -> dict[str, Handler]:
        return {"email_recuperacao": self.email_recuperacao, "email_alerta": self.email_alerta}

    def email_recuperacao(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # O token nasce aqui e só o hash vai para o banco; o link usa o fragmento (#), que não vai
        # para logs de servidor nem para o Referer.
        # Só o SHA-256 vai ao banco (nem o log do Postgres vê o token); o banco confere que este job
        # de recuperação está em execução por nós.
        token = secrets.token_urlsafe(32)
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "select email from core.emitir_token_recuperacao(%s, %s, %s)",
                (job["id"], job["execucao"], hashlib.sha256(token.encode()).digest()),
            )
            dest = cur.fetchone()
        conn.commit()
        if dest is None:
            return  # conta inativa: nada a enviar (a resposta da API já foi neutra)
        link = f"{self._s.app_url.rstrip('/')}/redefinir-senha#token={token}"
        self._enviador.enviar(mensagem_recuperacao(dest["email"], link))

    def email_alerta(self, conn: psycopg.Connection[Any], job: Job) -> None:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "select email::text as email from core.usuarios "
                "where id = %s and ativo and deleted_at is null",
                (job["payload"]["usuario_id"],),
            )
            dest = cur.fetchone()
        if dest is None:
            return
        eventos = [str(e) for e in job["payload"].get("eventos", [])]
        msg = mensagem_alerta(dest["email"], eventos)
        if msg is not None:
            self._enviador.enviar(msg)


def processar_lote(conn: psycopg.Connection[Any], handlers: dict[str, Handler]) -> int:
    """Pega até 10 jobs dos tipos conhecidos, executa e conclui ou devolve com backoff."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("select * from ops.pegar_jobs(%s, 10)", (list(handlers),))
        jobs = cur.fetchall()
    conn.commit()
    for job in jobs:
        ctx = {"job": str(job["id"]), "tipo": job["tipo"], "tentativa": job["tentativas"]}
        try:
            handlers[job["tipo"]](conn, job)
        except Exception as e:  # toda falha volta para a fila com backoff
            conn.rollback()
            # Só o tipo do erro: a mensagem pode trazer e-mail ou dado da conta.
            conn.execute(
                "select ops.falhar_job(%s, %s, %s)", (job["id"], job["execucao"], type(e).__name__)
            )
            conn.commit()
            log.warning("job falhou", extra={"ctx": {**ctx, "erro": type(e).__name__}})
            continue
        conn.execute("select ops.concluir_job(%s, %s)", (job["id"], job["execucao"]))
        conn.commit()
        log.info("job concluído", extra={"ctx": ctx})
    return len(jobs)


def consumir(settings: Settings, enviador: Enviador, parar: threading.Event) -> None:
    """Laço do consumidor: LISTEN ops_jobs com polling de reserva a cada 30 s."""
    global ultimo_ciclo  # noqa: PLW0603 - heartbeat lido pelo /health
    handlers = Handlers(settings, enviador).tipos()
    while not parar.is_set():
        try:
            with psycopg.connect(settings.database_url.get_secret_value()) as conn:
                conn.execute("listen ops_jobs")
                conn.commit()
                while not parar.is_set():
                    ultimo_ciclo = time.monotonic()
                    if processar_lote(conn, handlers) == 0:
                        for _ in conn.notifies(timeout=30, stop_after=1):
                            pass
        except Exception as e:  # qualquer erro: registra e tenta de novo (a thread não morre)
            erro = {"ctx": {"erro": type(e).__name__}}
            log.error("fila com erro; nova tentativa em 10 s", extra=erro)
            parar.wait(10)
