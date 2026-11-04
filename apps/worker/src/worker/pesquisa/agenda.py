"""Agendador e vigilância da pesquisa de editais (Fase 04, RF-04.1 e RF-04.3; ADR-014).

O agendador só *enfileira*: cria a execução (`ops.execucoes`) e o job `coletar_fonte`, com chave de
idempotência por fonte e janela, então dois workers não duplicam. A vigilância marca como `perdida`
(e alerta o SUPERADMIN) a execução que não começou ou não terminou a tempo. Relógio sempre por
parâmetro: nada aqui chama `datetime.now()`.
"""

import json
import logging
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

log = logging.getLogger("worker.pesquisa.agenda")

FUSO = ZoneInfo("America/Sao_Paulo")
# <A DEFINIR> com a operação: atraso aceito para começar e tempo máximo de uma execução.
TOLERANCIA_INICIO = timedelta(minutes=15)
LIMITE_EXECUCAO = timedelta(minutes=60)


@dataclass(frozen=True)
class Janela:
    quando: datetime  # com fuso
    tipo: str  # principal (primeiro horário do dia) ou incremental

    @property
    def chave(self) -> str:
        return f"{self.quando:%Y-%m-%dT%H%M}"


def janelas_do_dia(dia: date, horarios: list[str]) -> list[Janela]:
    """Horários 'HH:MM' do dia em Brasília, em ordem; o primeiro é a varredura principal."""
    horas = sorted({time.fromisoformat(h) for h in horarios})
    return [
        Janela(datetime.combine(dia, h, tzinfo=FUSO), "principal" if i == 0 else "incremental")
        for i, h in enumerate(horas)
    ]


def janelas_devidas(agora: datetime, horarios: list[str]) -> list[Janela]:
    """Janelas de hoje que já deveriam ter começado."""
    local = agora.astimezone(FUSO)
    return [j for j in janelas_do_dia(local.date(), horarios) if j.quando <= local]


def atrasada(janela: Janela, agora: datetime, tolerancia: timedelta = TOLERANCIA_INICIO) -> bool:
    return agora - janela.quando > tolerancia


def alertar_superadmins(
    conn: psycopg.Connection[Any], agora: datetime, codigo: str, titulo: str, fonte: str
) -> None:
    """Notificação (vira push pelo gatilho do banco) e e-mail operacional, sem texto livre."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id from core.usuarios where superadmin and ativo and deleted_at is null"
        )
        admins = cur.fetchall()
    for a in admins:
        conn.execute(
            "insert into core.notificacoes (usuario_id, tipo, titulo, corpo, link) "
            "values (%s, 'pesquisa_alerta', %s, %s, '/plataforma/cobertura')",
            (a["id"], titulo, f"Fonte: {fonte}. Veja o painel de cobertura."),
        )
        conn.execute(
            "select ops.enfileirar_pesquisa('email_operacional', null, %s::jsonb, %s)",
            (
                json.dumps({"usuario_id": str(a["id"]), "codigo": codigo, "fonte": fonte}),
                f"op:{codigo}:{fonte}:{a['id']}:{agora.astimezone(FUSO):%Y%m%d%H}",
            ),
        )


def agendar(conn: psycopg.Connection[Any], agora: datetime) -> int:
    """Cria as execuções devidas hoje e enfileira a coleta. Devolve quantas novas."""
    novas = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("select id, slug, horarios from ops.fontes where ativa")
        fontes = cur.fetchall()
    for f in fontes:
        for j in janelas_devidas(agora, list(f["horarios"])):
            perdida = atrasada(j, agora)
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(
                    "insert into ops.execucoes (fonte_id, tipo, agendada_para, status, detalhe) "
                    "values (%s, %s, %s, %s, %s::jsonb) "
                    "on conflict (fonte_id, tipo, agendada_para) do nothing returning id",
                    (
                        f["id"],
                        j.tipo,
                        j.quando,
                        "perdida" if perdida else "agendada",
                        json.dumps({"recuperada": True}) if perdida else "{}",
                    ),
                )
                nova = cur.fetchone()
            if nova is None:
                continue
            novas += 1
            conn.execute(
                "select ops.enfileirar_pesquisa('coletar_fonte', null, %s::jsonb, %s)",
                (json.dumps({"execucao_id": str(nova["id"])}), f"coleta:{f['slug']}:{j.chave}"),
            )
            if perdida:  # a coleta roda mesmo assim (recupera), mas o atraso é avisado
                alertar_superadmins(
                    conn, agora, "pesquisa_perdida", "Pesquisa fora do horário", f["slug"]
                )
            conn.commit()
    return novas


def vigiar(conn: psycopg.Connection[Any], agora: datetime) -> int:
    """Execução que não começou vira perdida; a que não terminou, falha. Alerta uma vez."""
    marcadas = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "update ops.execucoes e set status = 'perdida' from ops.fontes f "
            "where f.id = e.fonte_id and e.status = 'agendada' and e.agendada_para < %s "
            "returning f.slug",
            (agora - TOLERANCIA_INICIO,),
        )
        perdidas = cur.fetchall()
        cur.execute(
            "update ops.execucoes e set status = 'falhou', concluida_em = %s, "
            "erro_tipo = 'tempo_excedido' from ops.fontes f "
            "where f.id = e.fonte_id and e.status = 'executando' and e.iniciada_em < %s "
            "returning f.slug",
            (agora, agora - LIMITE_EXECUCAO),
        )
        travadas = cur.fetchall()
    for r in perdidas:
        alertar_superadmins(conn, agora, "pesquisa_perdida", "Pesquisa não executou", r["slug"])
    for r in travadas:
        alertar_superadmins(conn, agora, "pesquisa_falhou", "Pesquisa travada", r["slug"])
    conn.commit()
    marcadas = len(perdidas) + len(travadas)
    return marcadas


def pingar(url: str) -> None:
    """Heartbeat externo (Healthchecks.io). Falha de rede nunca derruba a execução."""
    if not url.startswith("https://"):
        return
    try:
        urllib.request.urlopen(url, timeout=10).close()  # noqa: S310 - https validado acima
    except OSError as e:
        log.warning("heartbeat falhou", extra={"ctx": {"erro": type(e).__name__}})
