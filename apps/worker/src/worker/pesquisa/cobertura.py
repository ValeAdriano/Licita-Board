"""Cobertura contra a amostra de referência (Fase 04, RF-04.17).

Cada edital real conhecido de PR e SC é procurado em `pub.editais` pelo número de controle
do PNCP.
Sem amostra, nada é calculado e o painel mostra "não medida" (nunca 100%). Quem classifica a
causa de um não encontrado é uma pessoa.
"""

import re
from datetime import date
from typing import Any

import psycopg
from psycopg.rows import dict_row

_CONTROLE = re.compile(r"\b(\d{14})-(\d)-(\d{6})/(\d{4})\b")
_LINK = re.compile(r"/editais/(\d{14})/(\d{4})/(\d{1,9})")


def numero_de_controle(referencia: str) -> str | None:
    """Número de controle do PNCP a partir do próprio número ou do link do edital."""
    m = _CONTROLE.search(referencia)
    if m:
        return m.group(0)
    link = _LINK.search(referencia)
    if link:
        cnpj, ano, seq = link.groups()
        return f"{cnpj}-1-{int(seq):06d}/{ano}"
    return None


def apurar(conn: psycopg.Connection[Any], mes: date) -> dict[str, int]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id, referencia, uf from ops.amostra_cobertura where mes_referencia = %s", (mes,)
        )
        amostra = cur.fetchall()
        cur.execute("select parametros -> 'ufs' as ufs from ops.fontes where slug = 'pncp'")
        fonte = cur.fetchone()
    ufs = set(fonte["ufs"]) if fonte and fonte["ufs"] else set()
    achados = 0
    for a in amostra:
        controle = numero_de_controle(a["referencia"])
        edital = None
        if controle:
            with conn.cursor() as cur:
                cur.execute("select id from pub.editais where id_externo = %s", (controle,))
                edital = cur.fetchone()
        causa = None
        if edital is None and ufs and a["uf"] not in ufs:
            causa = "fonte_nao_coberta"  # a única causa que o código sabe afirmar sozinho
        conn.execute(
            "insert into ops.cobertura_resultados (amostra_id, encontrado, edital_id, causa) "
            "values (%s, %s, %s, %s)",
            (a["id"], edital is not None, edital[0] if edital else None, causa),
        )
        achados += edital is not None
    conn.commit()
    return {"total": len(amostra), "encontrados": achados}
