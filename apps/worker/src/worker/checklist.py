"""Job `checklist_documental` (Fase 03, RF-03.10): situação de cada exigência documental de UM acompanhamento.

Quem decide é código puro (`rules/checklist_documental.py`, sem IA): este módulo só lê o banco, chama a regra e grava o
resultado por função (`priv.registrar_checklist`, que confere de novo empresa, exigências e documentos). O worker não lê
`priv.documentos`: recebe tipo, validade e "sem vencimento" da versão liberada mais recente por
`priv.checklist_documentos`. Data da sessão = dia da abertura do acompanhamento em Brasília (confirmada ou não; o
resultado guarda se estava confirmada). Idempotente: rodar de novo regrava o mesmo resultado.
"""

import json
import logging
from datetime import date, datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.rules.alertas import FUSO
from worker.rules.checklist_documental import (
    DocumentoEmpresa,
    Exigencia,
    Situacao,
    checklist_documental,
)

log = logging.getLogger("worker.checklist")


def _melhor_id(docs: list[tuple[str, DocumentoEmpresa]], tipo: str) -> str | None:
    """Mesmo critério da regra (maior validade; sem vencimento vence todos), só para apontar QUAL documento valeu."""
    do_tipo = [d for d in docs if d[1].tipo == tipo]
    if not do_tipo:
        return None
    return max(do_tipo, key=lambda d: (d[1].sem_vencimento, d[1].validade or date.min))[0]


def calcular(
    conn: psycopg.Connection[Any], acompanhamento_id: str, agora: datetime, empresa_job: Any = None
) -> int | None:
    """Grava a situação de cada exigência e devolve quantas; None se o acompanhamento não existe ou não é da empresa."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id, empresa_id, data_abertura, abertura_confirmada from priv.acompanhamentos "
            "where id = %s and deleted_at is null",
            (acompanhamento_id,),
        )
        a = cur.fetchone()
        if a is None or (empresa_job is not None and str(a["empresa_id"]) != str(empresa_job)):
            return (
                None  # nunca confie no payload: o acompanhamento tem de ser da empresa do job (T2)
            )
        empresa = a["empresa_id"]
        cur.execute(
            "select e.id, t.slug, e.aplicavel, e.conferencia_manual, e.regularidade_fiscal "
            "from priv.checklist_exigencias e join pub.tipos_documento t on t.id = e.tipo_id "
            "where e.acompanhamento_id = %s and e.empresa_id = %s and e.deleted_at is null order by e.id",
            (a["id"], empresa),
        )
        exigencias = cur.fetchall()
        cur.execute(
            "select documento_id, tipo, validade, sem_vencimento from priv.checklist_documentos(%s)",
            (empresa,),
        )
        docs = [
            (
                str(r["documento_id"]),
                DocumentoEmpresa(r["tipo"], r["validade"], r["sem_vencimento"]),
            )
            for r in cur.fetchall()
        ]
        hoje = agora.astimezone(FUSO).date()
        cur.execute("select priv.checklist_me_epp(%s, %s) as me_epp", (empresa, hoje))
        me_epp = bool((cur.fetchone() or {}).get("me_epp"))
    sessao = a["data_abertura"].astimezone(FUSO).date() if a["data_abertura"] else None
    itens = checklist_documental(
        [
            Exigencia(e["slug"], e["aplicavel"], e["conferencia_manual"], e["regularidade_fiscal"])
            for e in exigencias
        ],
        [d for _, d in docs],
        hoje,
        sessao,
        me_epp,
    )
    carga = [
        {
            "exigencia_id": str(e["id"]),
            "situacao": i.situacao.value,
            "documento_id": None
            if i.situacao is Situacao.NAO_APLICAVEL
            else _melhor_id(docs, i.tipo),
            "validade": i.validade.isoformat() if i.validade else None,
            "dias_para_vencer": i.dias_para_vencer,
            "aviso": i.aviso,
        }
        for e, i in zip(exigencias, itens, strict=True)
    ]
    row = conn.execute(
        "select priv.registrar_checklist(%s, %s, %s::jsonb, %s, %s, %s, %s)",
        (empresa, a["id"], json.dumps(carga), hoje, sessao, a["abertura_confirmada"], me_epp),
    ).fetchone()
    conn.commit()
    n = int(row[0]) if row else 0
    log.info(
        "checklist calculado",
        extra={"ctx": {"acompanhamento": str(a["id"]), "itens": n, "me_epp": me_epp}},
    )
    return n


def enfileirar(conn: psycopg.Connection[Any], hoje: date) -> int:
    """Rodada diária: a situação muda com o calendário (um job por acompanhamento com checklist, por dia)."""
    row = conn.execute("select priv.enfileirar_checklists(%s)", (hoje,)).fetchone()
    conn.commit()
    return int(row[0]) if row else 0
