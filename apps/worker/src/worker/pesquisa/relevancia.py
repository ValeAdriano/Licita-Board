"""Job `avaliar_relevancia` (Fase 04): para um edital novo ou retificado, avalia cada item para cada
empresa que tem palavras-chave ativas e grava em `priv.oportunidades` (upsert; a triagem do usuário
é preservada). A regra em si é pura (`rules/relevancia.py`); aqui só há leitura e gravação.

O worker não confia no payload (só o id do edital): as empresas e os termos vêm do banco (T2).
"""

import json
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from worker.rules.relevancia import (
    VERSAO_REGRA,
    Filtros,
    ItemEntrada,
    Termo,
    TrechoRef,
    avaliar,
)

LIMITE_TRECHOS = 300


def _json(obj: Any) -> Jsonb:
    return Jsonb(obj, dumps=lambda o: json.dumps(o, default=str, ensure_ascii=False))


def _filtros(rows: list[dict[str, Any]]) -> Filtros:
    mins = [
        r["valor_min"] for r in rows if r["tipo"] == "faixa_valor" and r["valor_min"] is not None
    ]
    maxs = [
        r["valor_max"] for r in rows if r["tipo"] == "faixa_valor" and r["valor_max"] is not None
    ]
    return Filtros(
        ufs=tuple(r["uf"] for r in rows if r["tipo"] == "uf"),
        municipios=tuple((r["uf"], r["municipio"]) for r in rows if r["tipo"] == "municipio"),
        valor_min=min(mins) if mins else None,
        valor_max=max(maxs) if maxs else None,
        restricoes=tuple(r["texto"] for r in rows if r["tipo"] == "restricao"),
    )


def _trechos(
    cur: psycopg.Cursor[dict[str, Any]], edital_id: str, termos: list[Termo]
) -> tuple[TrechoRef, ...]:
    positivos = [t.texto.replace('"', " ") for t in termos if t.tipo != "exclusao"]
    exclusoes = [t.texto.replace('"', " ") for t in termos if t.tipo == "exclusao"]
    consulta = " OR ".join(f'"{t}"' for t in positivos + exclusoes if t.strip())
    if not consulta:
        return ()
    cur.execute(
        "select arquivo_id, pagina, texto from pub.trechos where edital_id = %s "
        "and tsv @@ websearch_to_tsquery('pub.pt_unaccent', %s) order by arquivo_id, pagina, ordem limit %s",
        (edital_id, consulta, LIMITE_TRECHOS),
    )
    return tuple(TrechoRef(str(r["arquivo_id"]), r["pagina"], r["texto"]) for r in cur.fetchall())


def avaliar_edital(conn: psycopg.Connection[Any], edital_id: str) -> int:
    """Devolve quantas oportunidades foram gravadas ou atualizadas."""
    gravadas = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select e.id, e.objeto, e.versao_atual, o.uf, o.municipio from pub.editais e "
            "join pub.orgaos o on o.id = e.orgao_id where e.id = %s",
            (edital_id,),
        )
        edital = cur.fetchone()
        if edital is None:
            return 0
        cur.execute(
            "select id, descricao, valor_total_estimado, (versao_final is null) as vigente "
            "from pub.edital_itens where edital_id = %s and tipo = 'item'",
            (edital_id,),
        )
        itens = cur.fetchall()
        cur.execute(
            "select distinct p.empresa_id from priv.palavras_chave p "
            "join core.empresas c on c.id = p.empresa_id and c.ativo and c.deleted_at is null "
            "where p.ativo and p.deleted_at is null"
        )
        empresas = [r["empresa_id"] for r in cur.fetchall()]
    for empresa_id in empresas:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "select tipo, termo from priv.palavras_chave where empresa_id = %s and ativo and deleted_at is null",
                (empresa_id,),
            )
            termos = [Termo(r["tipo"], r["termo"]) for r in cur.fetchall()]
            cur.execute(
                "select tipo, uf, municipio, valor_min, valor_max, texto from priv.palavras_chave_filtros "
                "where empresa_id = %s and deleted_at is null",
                (empresa_id,),
            )
            filtros = _filtros(cur.fetchall())
            trechos = _trechos(cur, edital_id, termos)
        for it in itens:
            if not it["vigente"]:  # retirado na retificação: marca, não apaga nem reavalia
                conn.execute(
                    "update priv.oportunidades set retirado = true where empresa_id = %s and item_id = %s",
                    (empresa_id, it["id"]),
                )
                continue
            valor = it["valor_total_estimado"]
            a = avaliar(
                ItemEntrada(it["descricao"], edital["objeto"], edital["uf"], edital["municipio"],
                            Decimal(valor) if valor is not None else None, trechos),
                termos,
                filtros,
            )  # fmt: skip
            conn.execute(
                "insert into priv.oportunidades (empresa_id, edital_id, item_id, nota, faixa, motivos, "
                "fora_dos_filtros, versao_regra, edital_versao) values (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
                "on conflict (empresa_id, item_id) do update set nota = excluded.nota, faixa = excluded.faixa, "
                "motivos = excluded.motivos, fora_dos_filtros = excluded.fora_dos_filtros, "
                "versao_regra = excluded.versao_regra, edital_versao = excluded.edital_versao, "
                "retirado = false, avaliada_em = now()",
                (empresa_id, edital_id, it["id"], a.nota, a.faixa, _json(a.motivos),
                 _json(a.fora_dos_filtros), VERSAO_REGRA, edital["versao_atual"]),
            )  # fmt: skip
            gravadas += 1
        conn.commit()
    return gravadas
