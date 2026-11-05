import datetime as dt
import hashlib
import logging
import secrets
import shutil
import threading
import time
from collections.abc import Callable
from typing import Any, cast
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

from worker.agenda import calcular_acompanhamento, garantir_feriados
from worker.agenda_alertas import TIPO as TIPO_EVENTO
from worker.agenda_alertas import processar as alertas_da_agenda
from worker.agenda_documentos import cruzar_todos as cruzar_documentos
from worker.agenda_retificacao import reavaliar as reavaliar_retificacoes
from worker.analise import analisar
from worker.chave_ia import cliente_da_empresa, testar_chave
from worker.documentos import Antivirus, Armazenamento, processar_versao
from worker.email import (
    Enviador,
    mensagem_agenda,
    mensagem_alerta,
    mensagem_operacional,
    mensagem_recuperacao,
)
from worker.extracao import extrair
from worker.minuta_ia import minutar
from worker.parecer import analisar as analisar_parecer
from worker.parecer import conferir as conferir_parecer
from worker.peca import processar as processar_peca
from worker.pesquisa.agenda import agendar, vigiar
from worker.pesquisa.arquivos import baixar, extrair_texto
from worker.pesquisa.cobertura import apurar
from worker.pesquisa.coleta import coletar
from worker.pesquisa.http import ClienteHttp, ErroPermanente
from worker.pesquisa.importacao import importar
from worker.pesquisa.relevancia import avaliar_edital
from worker.pesquisa.texto import Tesseract
from worker.preco import calcular_precificacao
from worker.proposta import Gravador, gerar_proposta, hoje_local
from worker.push import REDE, TTL_SEGUNDOS, EnviadorPush, Inscricao, carga_generica
from worker.recurso import ler as ler_recurso_terceiro
from worker.settings import Settings
from worker.sugestao import sugerir as sugerir_pecas_edital
from worker.tese import conferir as conferir_tese

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
            "coletar_fonte": self.coletar_fonte,
            "avaliar_relevancia": self.avaliar_relevancia,
            "importar_edital": self.importar_edital,
            "apurar_cobertura": self.apurar_cobertura,
            "calcular_prazos": self.calcular_prazos,
            "email_agenda": self.email_agenda,
            "analisar_item": self.analisar_item,
            "calcular_preco": self.calcular_preco,
            "gerar_proposta": self.gerar_proposta,
            "extrair_requisitos": self.extrair_requisitos,
            "testar_chave_ia": self.testar_chave_ia,
            "processar_peca": self.processar_peca,
            "minutar_peca": self.minutar_peca,
            "ler_recurso": self.ler_recurso,
            "validar_parecer": self.validar_parecer,
            "analisar_vencedora": self.analisar_vencedora,
            "sugerir_pecas": self.sugerir_pecas,
            "validar_tese": self.validar_tese,
        }
        # Sem chave VAPID o push fica desligado: o job espera na fila, sem tentativa gasta.
        if self._push is not None:
            tipos["push_notificacao"] = self.push_notificacao
        # Sem S3 e antivírus configurados, a quarentena espera: nada é liberado sem verificação.
        if self._s3 is not None and self._antivirus is not None:
            tipos["verificar_arquivo"] = self.verificar_arquivo
            tipos["baixar_arquivo_edital"] = self.baixar_arquivo_edital
            tipos["extrair_texto"] = self.extrair_texto
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

    def baixar_arquivo_edital(self, conn: psycopg.Connection[Any], job: Job) -> None:
        assert self._s3 is not None and self._antivirus is not None  # noqa: S101
        arquivo_id = str(job["payload"]["arquivo_id"])
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "select f.hosts_permitidos, f.parametros from pub.edital_arquivos a "
                "join pub.editais e on e.id = a.edital_id join ops.fontes f on f.id = e.fonte_id "
                "where a.id = %s",
                (arquivo_id,),
            )
            f = cur.fetchone()
        if f is None:
            return
        ua = f"VV-Licitacoes-Robo/1.0 (+{self._s.robo_contato or 'contato-nao-configurado'})"
        rps = float(f["parametros"].get("requisicoes_por_segundo", 2))
        http = ClienteHttp(ua, list(f["hosts_permitidos"]), rps)
        baixar(conn, arquivo_id, http, self._s3, self._antivirus)  # type: ignore[arg-type]

    def extrair_texto(self, conn: psycopg.Connection[Any], job: Job) -> None:
        assert self._s3 is not None  # noqa: S101
        ocr = Tesseract() if shutil.which("tesseract") else None
        agora = dt.datetime.now(dt.UTC)
        extrair_texto(conn, str(job["payload"]["arquivo_id"]), self._s3, ocr, agora)  # type: ignore[arg-type]

    def extrair_requisitos(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # Só o id da extração vem no payload; a empresa do job tem de ser a dona dela (T2). Sem chave, a IA fica desligada.
        cliente = cliente_da_empresa(conn, job.get("empresa_id"), self._s)
        extrair(conn, str(job["payload"]["extracao_id"]), cliente, job.get("empresa_id"))

    def testar_chave_ia(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # Teste barato da chave cadastrada pela empresa (1 mensagem mínima). O resultado vai para priv.empresa_ia; a chave nunca é logada.
        testar_chave(conn, str(job["payload"]["empresa_id"]), job.get("empresa_id"), self._s)

    def processar_peca(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # Só o id da peça vem no payload; a empresa do job tem de ser a dona dela (T2). Nunca protocola (regra 17).
        agora = dt.datetime.now(dt.UTC)
        processar_peca(
            conn,
            str(job["payload"]["peca_id"]),
            cast("Gravador | None", self._s3),
            hoje_local(agora),
            job.get("empresa_id"),
        )

    def minutar_peca(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # A IA só elabora o rascunho (origem 'ia'); a empresa do job tem de ser a dona do pedido (T2). Sem chave, fica "desligada".
        agora = dt.datetime.now(dt.UTC)
        cliente = cliente_da_empresa(conn, job.get("empresa_id"), self._s)
        minutar(
            conn,
            str(job["payload"]["minuta_id"]),
            cliente,
            hoje_local(agora),
            job.get("empresa_id"),
        )

    def ler_recurso(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # A IA só extrai as alegações do recurso de terceiro; a empresa do job tem de ser a dona dele (T2). Sem chave, fica "desligada".
        cliente = cliente_da_empresa(conn, job.get("empresa_id"), self._s)
        ler_recurso_terceiro(
            conn, str(job["payload"]["recurso_id"]), cliente, job.get("empresa_id")
        )

    def validar_parecer(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # Só o id do parecer vem no payload; a empresa do job tem de ser a dona dele (T2). Confere a evidência por código (sem IA).
        conferir_parecer(conn, str(job["payload"]["parecer_id"]), job.get("empresa_id"))

    def analisar_vencedora(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # A IA só SUGERE achados com citação literal; a classificação e a recomendação são humanas. Sem chave, fica "desligada".
        cliente = cliente_da_empresa(conn, job.get("empresa_id"), self._s)
        analisar_parecer(conn, str(job["payload"]["parecer_id"]), cliente, job.get("empresa_id"))

    def sugerir_pecas(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # A IA só SUGERE esclarecimentos/impugnações (trecho literal conferido, fundamento só da base verificada); a empresa do job é a dona (T2).
        agora = dt.datetime.now(dt.UTC)
        cliente = cliente_da_empresa(conn, job.get("empresa_id"), self._s)
        sugerir_pecas_edital(
            conn, str(job["payload"]["execucao_id"]), cliente, agora, job.get("empresa_id")
        )

    def validar_tese(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # Confere as citações da tese contra a base verificada (sem IA); a empresa do job é a dona da tese (T2).
        conferir_tese(conn, str(job["payload"]["tese_id"]), job.get("empresa_id"))

    def gerar_proposta(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # Só o id da proposta vem no payload; a empresa do job tem de ser a dona dela (T2). Nunca envia ao portal (regra 17).
        agora = dt.datetime.now(dt.UTC)
        gerar_proposta(
            conn,
            str(job["payload"]["proposta_id"]),
            cast("Gravador | None", self._s3),
            hoje_local(agora),
            job.get("empresa_id"),
        )

    def calcular_preco(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # Só o id da precificação vem no payload; a empresa do job tem de ser a dona dela (T2). Dinheiro só em Decimal.
        calcular_precificacao(conn, str(job["payload"]["precificacao_id"]), job.get("empresa_id"))

    def analisar_item(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # Só o id da análise vem no payload; a empresa do job tem de ser a dona dela (T2). Quem classifica é código puro.
        analisar(conn, str(job["payload"]["analise_id"]), job.get("empresa_id"))

    def calcular_prazos(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # Só o id do acompanhamento vem no payload; empresa e datas são lidas do banco (T2).
        calcular_acompanhamento(conn, str(job["payload"]["acompanhamento_id"]))

    def email_agenda(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # Só ids no payload: destinatário, prazo e órgão são relidos do banco (e o usuário precisa ainda ter acesso).
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "select u.email::text as email, ev.tipo, ev.data_limite_legal, ev.acompanhamento_id, g.razao_social as orgao "
                "from priv.agenda_eventos ev join priv.acompanhamentos a on a.id = ev.acompanhamento_id "
                "join pub.editais e on e.id = a.edital_id join pub.orgaos g on g.id = e.orgao_id, core.usuarios u "
                "where ev.id = %s and u.id = %s and u.ativo and u.deleted_at is null and exists ("
                "select 1 from core.vinculos v join core.permissoes p on p.vinculo_id = v.id "
                "where v.usuario_id = u.id and v.empresa_id = ev.empresa_id and v.ativo and v.deleted_at is null "
                "and p.modulo = 'agenda' and p.acao = 'visualizar')",
                (job["payload"]["evento_id"], job["payload"]["usuario_id"]),
            )
            r = cur.fetchone()
        if r is None or r["data_limite_legal"] is None:
            return
        limite = (
            r["data_limite_legal"]
            .astimezone(dt.timezone(dt.timedelta(hours=-3)))
            .strftime("%d/%m/%Y %H:%M")
        )
        self._enviador.enviar(
            mensagem_agenda(
                r["email"], str(TIPO_EVENTO.get(r["tipo"], r["tipo"])), r["orgao"], str(job["payload"]["marco"]),
                limite, str(r["acompanhamento_id"]), self._s.app_url,
            )
        )  # fmt: skip

    def apurar_cobertura(self, conn: psycopg.Connection[Any], job: Job) -> None:
        apurar(conn, dt.date.fromisoformat(str(job["payload"]["mes"])))

    def importar_edital(self, conn: psycopg.Connection[Any], job: Job) -> None:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("select hosts_permitidos, parametros from ops.fontes where slug = 'pncp'")
            f = cur.fetchone()
        if f is None:
            raise ErroPermanente("fonte pncp não cadastrada")
        ua = f"VV-Licitacoes-Robo/1.0 (+{self._s.robo_contato or 'contato-nao-configurado'})"
        http = ClienteHttp(
            ua,
            list(f["hosts_permitidos"]),
            float(f["parametros"].get("requisicoes_por_segundo", 2)),
        )
        importar(conn, str(job["payload"]["importacao_id"]), http)

    def avaliar_relevancia(self, conn: psycopg.Connection[Any], job: Job) -> None:
        avaliar_edital(conn, str(job["payload"]["edital_id"]))

    def coletar_fonte(self, conn: psycopg.Connection[Any], job: Job) -> None:
        # Só a execução do banco manda: fonte, janela e parâmetros nunca vêm do payload.
        execucao_id = str(job["payload"]["execucao_id"])
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "select f.hosts_permitidos, f.parametros from ops.execucoes e "
                "join ops.fontes f on f.id = e.fonte_id where e.id = %s and f.ativa",
                (execucao_id,),
            )
            f = cur.fetchone()
        if f is None:
            raise ErroPermanente("execução inexistente ou fonte desativada")
        if not self._s.robo_contato and self._s.env != "dev":
            raise ErroPermanente("VV_ROBO_CONTATO é obrigatório fora de dev")
        ua = f"VV-Licitacoes-Robo/1.0 (+{self._s.robo_contato or 'contato-nao-configurado'})"
        rps = float(f["parametros"].get("requisicoes_por_segundo", 2))
        http = ClienteHttp(ua, list(f["hosts_permitidos"]), rps)
        coletar(
            conn,
            execucao_id,
            http,
            dt.datetime.now(dt.UTC),
            ultima_tentativa=job["tentativas"] >= job["max_tentativas"],
            heartbeat=self._s.pesquisa_heartbeat_url,
        )

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
    garantir_feriados(
        conn, range(hoje.year - 1, hoje.year + 4)
    )  # nacionais fixos e móveis, idempotente
    n = conn.execute("select priv.gerar_alertas_documentos(%s)", (hoje,)).fetchone()
    if hoje.day == 1:  # cobertura do mês contra a amostra (idempotente pela chave do mês)
        conn.execute(
            "select ops.enfileirar_pesquisa('apurar_cobertura', null, %s::jsonb, %s)",
            (f'{{"mes": "{hoje:%Y-%m-01}"}}', f"cobertura:{hoje:%Y-%m}"),
        )
    conn.commit()
    log.info("alertas de documentos", extra={"ctx": {"novos": n[0] if n else 0}})
    return hoje


# Jobs longos da pesquisa de editais (coleta de horas, downloads, OCR) rodam num consumidor próprio:
# e-mail, push, verificação de documentos e o agendador não esperam atrás deles. Dentro do grupo,
# a coleta passa na frente dos downloads (a das 07h não fica atrás de centenas de arquivos).
PESADOS = frozenset({"coletar_fonte", "baixar_arquivo_edital", "extrair_texto", "indexar_trechos"})
PRIORIDADE_PESADOS = frozenset({"coletar_fonte"})


def consumir(
    settings: Settings,
    enviador: Enviador,
    parar: threading.Event,
    push: EnviadorPush | None = None,
    pesado: bool = False,
) -> None:
    """Laço do consumidor: LISTEN ops_jobs com polling de reserva a cada 30 s.

    `pesado=False` cuida dos jobs curtos e do agendador; `pesado=True`, dos jobs longos da pesquisa.
    """
    global ultimo_ciclo  # noqa: PLW0603 - heartbeat lido pelo /health
    s3 = antivirus = None
    if settings.s3_endpoint and settings.s3_bucket and settings.clamav_host:
        from worker.documentos import Clamd  # noqa: PLC0415 - só quando o repositório documental está ligado
        from worker.s3 import ArmazenamentoS3  # noqa: PLC0415

        s3, antivirus = (
            ArmazenamentoS3(settings),
            Clamd(settings.clamav_host, settings.clamav_porta),
        )
    todos = Handlers(settings, enviador, push, s3, antivirus).tipos()
    handlers = {t: h for t, h in todos.items() if (t in PESADOS) == pesado}
    prioritarios = {t: h for t, h in handlers.items() if t in PRIORIDADE_PESADOS}
    ultimo_alerta: dt.date | None = None
    ultima_hora_agenda = ""
    while not parar.is_set():
        try:
            with psycopg.connect(settings.database_url.get_secret_value()) as conn:
                conn.execute("listen ops_jobs")
                conn.commit()
                while not parar.is_set():
                    ultimo_ciclo = time.monotonic()
                    if not pesado:
                        ultimo_alerta = alertas_do_dia(
                            conn, dt.datetime.now(FUSO).date(), ultimo_alerta
                        )
                        try:  # o agendador nunca derruba o consumo da fila
                            agora = dt.datetime.now(dt.UTC)
                            agendar(conn, agora)
                            vigiar(conn, agora)
                            hora = agora.astimezone(FUSO).strftime("%Y%m%d%H")
                            if (
                                hora != ultima_hora_agenda
                            ):  # alertas da agenda e prazo perdido: uma vez por hora
                                reavaliar_retificacoes(conn)
                                cruzar_documentos(conn, agora)
                                alertas_da_agenda(conn, agora)
                                ultima_hora_agenda = hora
                        except Exception as e:
                            conn.rollback()
                            log.error(
                                "agendador com erro", extra={"ctx": {"erro": type(e).__name__}}
                            )
                    feitos = processar_lote(conn, prioritarios) if prioritarios else 0
                    if feitos == 0:
                        feitos = processar_lote(conn, handlers)
                    if feitos == 0:
                        for _ in conn.notifies(timeout=30, stop_after=1):
                            pass
        except Exception as e:  # qualquer erro: registra e tenta de novo (a thread não morre)
            erro = {"ctx": {"erro": type(e).__name__}}
            log.error("fila com erro; nova tentativa em 10 s", extra=erro)
            parar.wait(10)
