import datetime as dt
import hashlib
import logging
import secrets
import threading
import time
from collections.abc import Callable
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

from worker.documentos import Antivirus, Armazenamento, processar_versao
from worker.email import Enviador, mensagem_alerta, mensagem_operacional, mensagem_recuperacao
from worker.pesquisa.agenda import agendar, vigiar
from worker.push import REDE, TTL_SEGUNDOS, EnviadorPush, Inscricao, carga_generica
from worker.settings import Settings

log = logging.getLogger("worker.fila")

# Último ciclo do consumidor (monotônico); o /health acusa fila parada (T7.2).
ultimo_ciclo: float = 0.0

Job = dict[str, Any]
Handler = Callable[[psycopg.Connection[Any], Job], None]


class PushTransitorio(Exception):  # noqa: N818 - falha temporária, o job volta com backoff
    """Algum dispositivo falhou por motivo passageiro (rede, 429, 5xx)."""


class PushConfiguracao(Exception):  # noqa: N818 - chave VAPID recusada pelo serviço de push
    """401/403 do serviço de push: configuração (par de chaves), não dispositivo ruim."""


class Handlers:
    """Um método por tipo de job. Payload só traz IDs; dado sensível nunca entra no log."""

    def __init__(
        self,
        settings: Settings,
        enviador: Enviador,
        push: EnviadorPush | None = None,
        s3: Armazenamento | None = None,
        antivirus: Antivirus | None = None,
    ) -> None:
        self._s = settings
        self._enviador = enviador
        self._push = push
        self._s3 = s3
        self._antivirus = antivirus

    def tipos(self) -> dict[str, Handler]:
        tipos: dict[str, Handler] = {
            "email_recuperacao": self.email_recuperacao,
            "email_alerta": self.email_alerta,
            "email_operacional": self.email_operacional,
        }
        # Sem chave VAPID o push fica desligado: o job espera na fila, sem tentativa gasta.
        if self._push is not None:
            tipos["push_notificacao"] = self.push_notificacao
        # Sem S3 e antivírus configurados, a quarentena espera: nada é liberado sem verificação.
        if self._s3 is not None and self._antivirus is not None:
            tipos["verificar_arquivo"] = self.verificar_arquivo
        return tipos

    def verificar_arquivo(self, conn: psycopg.Connection[Any], job: Job) -> None:
        assert self._s3 is not None and self._antivirus is not None  # noqa: S101 - só registrado ligado
        processar_versao(conn, str(job["payload"]["versao_id"]), self._s3, self._antivirus)

    def push_notificacao(self, conn: psycopg.Connection[Any], job: Job) -> None:
        assert self._push is not None  # noqa: S101 - só registrado com push ligado
        notificacao_id = str(job["payload"]["notificacao_id"])
        with conn.cursor(row_factory=dict_row) as cur:
            # Só notificação recente (ligar o push depois não dispara aviso de coisa velha) e só
            # quem ainda não recebeu este job (reenvio após falha de outro dispositivo não duplica).
            cur.execute(
                "select d.id, d.endpoint, d.p256dh, d.auth from core.notificacoes n "
                "join core.usuarios u on u.id = n.usuario_id and u.ativo and u.deleted_at is null "
                "join core.dispositivos_push d "
                "on d.usuario_id = n.usuario_id and d.revogado_em is null "
                "and (d.ultimo_envio_em is null or d.ultimo_envio_em < %s) "
                "where n.id = %s and n.created_at > now() - make_interval(secs => %s)",
                (job["created_at"], notificacao_id, TTL_SEGUNDOS),
            )
            dispositivos = cur.fetchall()
        carga = carga_generica(notificacao_id)
        transitorios = 0
        configuracao = 0
        for d in dispositivos:
            inscricao = Inscricao(str(d["id"]), d["endpoint"], d["p256dh"], d["auth"])
            status = self._push.enviar(inscricao, carga)
            if 200 <= status < 300:
                conn.execute(
                    "update core.dispositivos_push set ultimo_envio_em = now(), falhas = 0 "
                    "where id = %s",
                    (d["id"],),
                )
            elif status in (404, 410):  # inscrição expirou ou o usuário a removeu no navegador
                conn.execute(
                    "update core.dispositivos_push set revogado_em = now() where id = %s",
                    (d["id"],),
                )
            elif status in (REDE, 429) or status >= 500:
                # Falha do serviço de push, da rede ou do nosso servidor: NÃO conta contra o
                # dispositivo (instabilidade não pode revogar todo mundo); o job volta com backoff.
                transitorios += 1
            elif status in (401, 403):
                # Chave VAPID que o serviço de push não aceita (par errado, chave trocada): erro de
                # configuração, não do dispositivo. Nada é revogado; o job volta e, esgotado, falha.
                configuracao += 1
            else:
                # Resposta definitiva de recusa (inscrição inválida): 5 seguidas revogam.
                conn.execute(
                    "update core.dispositivos_push set falhas = falhas + 1, "
                    "revogado_em = case when falhas + 1 >= 5 then now() end where id = %s",
                    (d["id"],),
                )
            conn.commit()
            log.info(
                "push processado", extra={"ctx": {"dispositivo": str(d["id"]), "status": status}}
            )
        if configuracao:
            log.error(
                "push recusado pela chave VAPID", extra={"ctx": {"dispositivos": configuracao}}
            )
            raise PushConfiguracao(configuracao)
        if transitorios:
            raise PushTransitorio(transitorios)

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

    def email_operacional(self, conn: psycopg.Connection[Any], job: Job) -> None:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "select email::text as email from core.usuarios "
                "where id = %s and ativo and deleted_at is null and superadmin",
                (job["payload"]["usuario_id"],),
            )
            dest = cur.fetchone()
        if dest is None:
            return
        msg = mensagem_operacional(
            dest["email"],
            str(job["payload"].get("codigo", "")),
            str(job["payload"].get("fonte", "")),
            self._s.app_url,
        )
        if msg is not None:
            self._enviador.enviar(msg)

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


FUSO = ZoneInfo("America/Sao_Paulo")


def alertas_do_dia(conn: psycopg.Connection[Any], hoje: dt.date, ultimo: dt.date | None) -> dt.date:
    """Uma vez por dia (e na partida) gera os alertas de vencimento (idempotente)."""
    if ultimo == hoje:
        return hoje
    n = conn.execute("select priv.gerar_alertas_documentos(%s)", (hoje,)).fetchone()
    conn.commit()
    log.info("alertas de documentos", extra={"ctx": {"novos": n[0] if n else 0}})
    return hoje


def consumir(
    settings: Settings,
    enviador: Enviador,
    parar: threading.Event,
    push: EnviadorPush | None = None,
) -> None:
    """Laço do consumidor: LISTEN ops_jobs com polling de reserva a cada 30 s."""
    global ultimo_ciclo  # noqa: PLW0603 - heartbeat lido pelo /health
    s3 = antivirus = None
    if settings.s3_endpoint and settings.s3_bucket and settings.clamav_host:
        from worker.documentos import Clamd  # noqa: PLC0415 - só quando o repositório documental está ligado
        from worker.s3 import ArmazenamentoS3  # noqa: PLC0415

        s3, antivirus = (
            ArmazenamentoS3(settings),
            Clamd(settings.clamav_host, settings.clamav_porta),
        )
    handlers = Handlers(settings, enviador, push, s3, antivirus).tipos()
    ultimo_alerta: dt.date | None = None
    while not parar.is_set():
        try:
            with psycopg.connect(settings.database_url.get_secret_value()) as conn:
                conn.execute("listen ops_jobs")
                conn.commit()
                while not parar.is_set():
                    ultimo_ciclo = time.monotonic()
                    ultimo_alerta = alertas_do_dia(
                        conn, dt.datetime.now(FUSO).date(), ultimo_alerta
                    )
                    try:  # o agendador nunca derruba o consumo da fila
                        agora = dt.datetime.now(dt.UTC)
                        agendar(conn, agora)
                        vigiar(conn, agora)
                    except Exception as e:
                        conn.rollback()
                        log.error("agendador com erro", extra={"ctx": {"erro": type(e).__name__}})
                    if processar_lote(conn, handlers) == 0:
                        for _ in conn.notifies(timeout=30, stop_after=1):
                            pass
        except Exception as e:  # qualquer erro: registra e tenta de novo (a thread não morre)
            erro = {"ctx": {"erro": type(e).__name__}}
            log.error("fila com erro; nova tentativa em 10 s", extra=erro)
            parar.wait(10)
