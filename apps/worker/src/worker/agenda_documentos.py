"""Cruza os documentos da empresa com a abertura confirmada do edital (Fase 05, RF-05.15).

Um evento `documento_vence` por acompanhamento (a lista vai no aviso). Idempotente: rodar de novo só muda o que mudou.
- Há documento que vence antes da abertura: cria/atualiza o evento (limite = fim do dia do primeiro vencimento) e avisa
  o responsável e os gestores quando o evento nasce ou a lista muda.
- Todos renovados: o evento ainda aberto vira "dispensado" com justificativa automática (reabre se voltar a haver).
Decisão humana nunca é desfeita: evento dispensado/protocolado por uma pessoa não é reaberto.
Só vale com a abertura CONFIRMADA (abertura provisória do PNCP não gera alerta de documento).
"""

import logging
from datetime import UTC, datetime, time
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.agenda_alertas import destinatarios
from worker.rules.alertas import ABERTOS, FUSO
from worker.rules.vencimentos import Documento, resumo, vencem_antes

log = logging.getLogger("worker.agenda_documentos")
AUTO = "[automático] "


def _documentos(conn: psycopg.Connection[Any], empresa: Any) -> list[Documento]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select d.descricao, v.validade, d.em_atualizacao from priv.documentos d "
            "join lateral (select x.validade from priv.documento_versoes x where x.documento_id = d.id "
            "and x.status_arquivo <> 'bloqueado' order by x.versao desc limit 1) v on true "
            "where d.empresa_id = %s and d.deleted_at is null and not d.sem_vencimento and v.validade is not null",
            (empresa,),
        )
        return [
            Documento(r["descricao"], r["validade"], r["em_atualizacao"]) for r in cur.fetchall()
        ]


def _avisar(
    conn: psycopg.Connection[Any],
    a: dict[str, Any],
    texto: str,
    cache: dict[Any, dict[str, list[Any]]],
) -> None:
    ds = destinatarios(conn, cache, a["empresa_id"])
    for u in {*ds["gestores"], *([a["responsavel_id"]] if a["responsavel_id"] else [])}:
        conn.execute(
            "insert into core.notificacoes (usuario_id, empresa_id, modulo, tipo, titulo, corpo, link) "
            "values (%s, %s, 'agenda', 'agenda_documento', 'Documento vence antes da disputa', %s, %s)",
            (u, a["empresa_id"], texto[:1000], f"/agenda/acompanhamentos/{a['id']}"),
        )


def cruzar(
    conn: psycopg.Connection[Any],
    a: dict[str, Any],
    agora: datetime,
    cache: dict[Any, dict[str, list[Any]]],
) -> str:
    """Devolve 'criado', 'atualizado', 'resolvido' ou '' (nada mudou)."""
    dia_abertura = a["data_abertura"].astimezone(FUSO).date()
    hoje = agora.astimezone(FUSO).date()
    docs = vencem_antes(_documentos(conn, a["empresa_id"]), dia_abertura)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id, status, aviso_calculo, justificativa from priv.agenda_eventos "
            "where acompanhamento_id = %s and tipo = 'documento_vence' for update",
            (a["id"],),
        )
        ev = cur.fetchone()
    if not docs:
        if ev and ev["status"] in ABERTOS:
            conn.execute(
                "update priv.agenda_eventos set status = 'dispensado', justificativa = %s, calculado_em = %s where id = %s",
                (AUTO + "todos os documentos foram renovados", agora, ev["id"]),
            )
            conn.execute(
                "insert into priv.agenda_evento_historico (empresa_id, evento_id, campo, antes, depois, motivo) "
                "values (%s, %s, 'status', %s, 'dispensado', 'documentos renovados (automático)')",
                (a["empresa_id"], ev["id"], ev["status"]),
            )
            return "resolvido"
        return ""
    texto = resumo(docs, dia_abertura, hoje)
    limite = datetime.combine(docs[0].validade, time(23, 59), tzinfo=FUSO).astimezone(UTC)
    if ev is None:
        row = conn.execute(
            "insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, base_data, data_limite_legal, origem_prazo, "
            "provisorio, regra_validada, aviso_calculo, calculado_em) values (%s, %s, 'documento_vence', %s, %s, 'regra', false, true, %s, %s) returning id",
            (a["empresa_id"], a["id"], a["data_abertura"], limite, texto, agora),
        ).fetchone()
        assert row is not None  # noqa: S101
        conn.execute(
            "insert into priv.agenda_evento_historico (empresa_id, evento_id, campo, antes, depois, motivo) "
            "values (%s, %s, 'data_limite_legal', null, %s, 'cruzamento de documentos')",
            (a["empresa_id"], row[0], str(limite)),
        )
        _avisar(conn, a, texto, cache)
        return "criado"
    reabre = ev["status"] == "dispensado" and (ev["justificativa"] or "").startswith(AUTO)
    if texto == ev["aviso_calculo"] and not reabre:
        return ""
    if ev["status"] not in ABERTOS and not reabre:
        return ""  # decisão humana (protocolado, dispensado à mão...) não se desfaz
    conn.execute(
        "update priv.agenda_eventos set base_data = %s, data_limite_legal = %s, aviso_calculo = %s, calculado_em = %s, "
        "status = case when %s then 'sugerido' else status end, justificativa = case when %s then null else justificativa end where id = %s",
        (a["data_abertura"], limite, texto, agora, reabre, reabre, ev["id"]),
    )
    conn.execute(
        "insert into priv.agenda_evento_historico (empresa_id, evento_id, campo, antes, depois, motivo) "
        "values (%s, %s, 'aviso', %s, %s, 'cruzamento de documentos')",
        (a["empresa_id"], ev["id"], (ev["aviso_calculo"] or "")[:300], texto[:300]),
    )
    _avisar(conn, a, texto, cache)
    return "atualizado"


def cruzar_todos(conn: psycopg.Connection[Any], agora: datetime) -> dict[str, int]:
    """Roda para todos os acompanhamentos abertos com abertura confirmada e ainda por vir (hora a hora)."""
    cache: dict[Any, dict[str, list[Any]]] = {}
    r = {"criado": 0, "atualizado": 0, "resolvido": 0}
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id, empresa_id, data_abertura, responsavel_id from priv.acompanhamentos "
            "where deleted_at is null and abertura_confirmada and data_abertura is not null and data_abertura > %s "
            "and status not in ('encerrado', 'desistiu')",
            (agora,),
        )
        acomps = cur.fetchall()
    for a in acomps:
        k = cruzar(conn, a, agora, cache)
        if k:
            r[k] += 1
    conn.commit()
    log.info("documentos x abertura", extra={"ctx": r})
    return r
