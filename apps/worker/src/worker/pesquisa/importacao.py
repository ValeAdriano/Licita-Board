"""Job `importar_edital` (Fase 04, RF-04.16): edital que a coleta não achou, importado pelo link do PNCP.

O que vale é a linha de `priv.importacoes` (a URL já passou pela lista de hosts no banco); o payload só
traz o id. Hoje só o PNCP é reconhecido; outros endereços falham com motivo claro (upload: EM
DESENVOLVIMENTO). O resultado é o mesmo da coleta (mesma chave oficial): importar duas vezes, ou algo que a
coleta já trouxe, não duplica.
"""

import re
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.connectors.pncp import ConectorPNCP, Http
from worker.pesquisa.coleta import enfileirar_etapas
from worker.pesquisa.repositorio import gravar

_PNCP = re.compile(r"^https://pncp\.gov\.br/app/editais/(\d{14})/(\d{4})/(\d{1,9})/?$")


def importar(conn: psycopg.Connection[Any], importacao_id: str, http: Http) -> str:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select i.id, i.url, i.tipo, f.id as fonte_id from priv.importacoes i, ops.fontes f "
            "where i.id = %s and i.status = 'pendente' and f.slug = 'pncp'",
            (importacao_id,),
        )
        imp = cur.fetchone()
    if imp is None:
        return "ja_processada"
    conn.execute(
        "update priv.importacoes set status = 'processando' where id = %s", (importacao_id,)
    )
    conn.commit()
    m = _PNCP.match(imp["url"] or "")
    if m is None:
        return _falhar(
            conn, importacao_id, "endereço não reconhecido: use o link do edital no PNCP"
        )
    conector = ConectorPNCP(http)
    compra = conector.compra_por_endereco(m.group(1), int(m.group(2)), int(m.group(3)))
    if compra is None:
        return _falhar(conn, importacao_id, "edital não encontrado no PNCP")
    r = gravar(conn, imp["fonte_id"], conector.detalhar(compra))
    if r.situacao == "novo":
        conn.execute("update pub.editais set origem = 'manual' where id = %s", (r.edital_id,))
    if r.situacao != "igual":
        enfileirar_etapas(conn, r)
    conn.execute(
        "update priv.importacoes set status = 'ok', edital_id = %s, erro = null where id = %s",
        (r.edital_id, importacao_id),
    )
    conn.commit()
    return r.situacao


def _falhar(conn: psycopg.Connection[Any], importacao_id: str, motivo: str) -> str:
    conn.execute(
        "update priv.importacoes set status = 'falhou', erro = %s where id = %s",
        (motivo, importacao_id),
    )
    conn.commit()
    return "falhou"
