"""Job `validar_tese` (Fase 10, 10.8): confere que o texto da tese não cita nada fora da base jurídica verificada da empresa.

Mesma conferência das peças (`rules/citacoes`, código puro). Tese com citação fora da base fica BLOQUEADA e não pode ser aprovada; sem citação
nenhuma é permitida (aviso), porque o argumento pode ser puramente fático. A empresa do job precisa ser a dona da tese (T2).
"""

import json
import logging
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.peca import _base
from worker.rules.citacoes import nao_localizadas, verificar

log = logging.getLogger("worker.tese")


def divergencias(texto: str, base: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for c in nao_localizadas(texto, base):
        out.append(
            {
                "codigo": "citacao_fora_da_base",
                "mensagem": f"Citação fora da base jurídica verificada: “{c.trecho}”. Cadastre e verifique a fonte oficial ou retire a citação.",
                "bloqueia": True,
            }
        )
    if not verificar(texto, base):
        out.append(
            {
                "codigo": "sem_fundamento_citado",
                "mensagem": "A tese não cita nenhuma fonte da base verificada: confira se o argumento precisa de fundamento legal.",
                "bloqueia": False,
            }
        )
    if not base:
        out.append(
            {
                "codigo": "base_vazia",
                "mensagem": "A base jurídica verificada da empresa está vazia: nenhuma citação legal é aceita.",
                "bloqueia": False,
            }
        )
    return out


def conferir(conn: psycopg.Connection[Any], tese_id: str, empresa_job: Any = None) -> bool | None:
    """Grava `validacao`; devolve se está bloqueada, ou None se a tese não existe/não é da empresa do job."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id, empresa_id, texto from priv.teses where id = %s and deleted_at is null",
            (tese_id,),
        )
        t = cur.fetchone()
    if t is None or (empresa_job is not None and str(t["empresa_id"]) != str(empresa_job)):
        return None
    div = divergencias(t["texto"], _base(conn, t["empresa_id"]))
    bloq = any(d["bloqueia"] for d in div)
    conn.execute(
        "update priv.teses set validacao = %s::jsonb, validada_em = now(), bloqueada = %s where id = %s",
        (json.dumps(div), bloq, t["id"]),
    )
    conn.commit()
    log.info("tese conferida", extra={"ctx": {"tese": str(t["id"]), "bloqueada": bloq}})
    return bloq
