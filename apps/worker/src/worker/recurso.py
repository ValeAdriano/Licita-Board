"""Job `ler_recurso` (Fase 10, 10.6): a IA extrai as alegações do recurso de OUTRO licitante; a defesa de cada uma é decisão humana.

Cada alegação grava `origem = 'ia'`, a citação só se for LITERAL no texto do recurso (senão fica sem citação) e os fundamentos que o
recorrente invoca, marcando se estão na base jurídica verificada da empresa (informativo: a conferência que bloqueia é a da minuta).
Repetir a leitura troca só as alegações da IA que ninguém tratou (sem decisão e sem prova). Sem chave: `desligada`.
"""

import json
import logging
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.extracao import Cliente
from worker.llm.extracao_requisitos import ErroLLM
from worker.llm.leitura_recurso import SISTEMA, VERSAO_PROMPT, interpretar, montar_usuario
from worker.peca import _base
from worker.rules.citacoes import nao_localizadas
from worker.rules.evidencia import contem

log = logging.getLogger("worker.recurso")


def ler(
    conn: psycopg.Connection[Any], recurso_id: str, cliente: Cliente | None, empresa_job: Any = None
) -> str | None:
    """Status final, ou None se o recurso não existe/não é da empresa do job (nunca confie no payload, T2)."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id, empresa_id, recorrente, texto, leitura_status from priv.recursos_terceiros where id = %s",
            (recurso_id,),
        )
        r = cur.fetchone()
    if r is None or (empresa_job is not None and str(r["empresa_id"]) != str(empresa_job)):
        return None
    if r["leitura_status"] != "pendente":
        return str(r["leitura_status"])  # idempotente
    if cliente is None:
        return _fim(conn, r["id"], "desligada", "IA não configurada para esta empresa")
    usuario, truncado = montar_usuario(r["recorrente"], r["texto"])
    try:
        resp = cliente.completar(SISTEMA, usuario)
        alegacoes, descartadas = interpretar(resp.texto)
    except ErroLLM as e:
        return _fim(conn, r["id"], "falhou", str(e))
    base = _base(conn, r["empresa_id"])
    conn.execute(
        "delete from priv.recurso_alegacoes where recurso_id = %s and empresa_id = %s and origem = 'ia' and decisao is null and contra_prova is null",
        (r["id"], r["empresa_id"]),
    )
    ordem = conn.execute(
        "select coalesce(max(ordem), 0) from priv.recurso_alegacoes where recurso_id = %s",
        (r["id"],),
    ).fetchone()
    inicio = int(ordem[0]) if ordem else 0
    for n, a in enumerate(alegacoes, 1):
        confere = contem(a.citacao, r["texto"])
        fundamentos = [
            {"texto": f[:300], "na_base": not nao_localizadas(f, base)} for f in a.fundamentos
        ]
        conn.execute(
            "insert into priv.recurso_alegacoes (empresa_id, recurso_id, ordem, origem, resumo, citacao, citacao_confere, fundamentos, modelo_ia) "
            "values (%s, %s, %s, 'ia', %s, %s, %s, %s::jsonb, %s)",
            (
                r["empresa_id"],
                r["id"],
                inicio + n,
                a.resumo,
                a.citacao if confere else None,
                confere,
                json.dumps(fundamentos),
                resp.modelo,
            ),
        )
    conn.execute(
        "update priv.recursos_terceiros set leitura_status = 'concluida', leitura_modelo = %s, leitura_prompt_versao = %s, leitura_tokens_entrada = %s, "
        "leitura_tokens_saida = %s, leitura_erro = %s, leitura_em = now() where id = %s",
        (
            resp.modelo,
            VERSAO_PROMPT,
            resp.tokens_entrada,
            resp.tokens_saida,
            "texto do recurso truncado no limite do pedido"
            if truncado
            else (
                f"{descartadas} alegação(ões) fora do formato foram descartadas"
                if descartadas
                else None
            ),
            r["id"],
        ),
    )
    conn.commit()
    log.info("recurso lido", extra={"ctx": {"recurso": str(r["id"]), "alegacoes": len(alegacoes)}})
    return "concluida"


def _fim(conn: psycopg.Connection[Any], id_: Any, status: str, erro: str) -> str:
    conn.execute(
        "update priv.recursos_terceiros set leitura_status = %s, leitura_erro = %s, leitura_em = now() where id = %s",
        (status, erro[:500], id_),
    )
    conn.commit()
    return status
