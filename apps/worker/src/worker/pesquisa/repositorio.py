"""Gravação do dado público de licitações (Fase 04): upsert por identificador oficial, versões de
retificação, itens individualizados e eventos de reavaliação. Uma transação por edital."""

import json
from dataclasses import dataclass, field
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from worker.connectors.pncp import Compra, dumps

CAMPOS_EDITAL = (
    "numero_edital", "processo", "modalidade", "modo_disputa", "criterio_julgamento", "srp", "objeto",
    "valor_estimado", "situacao", "data_publicacao", "data_abertura_propostas",
    "data_encerramento_propostas", "data_sessao", "link_origem", "link_portal",
)  # fmt: skip


def _json(obj: Any) -> Jsonb:
    return Jsonb(obj, dumps=lambda o: json.dumps(o, default=str, ensure_ascii=False))


@dataclass
class Resultado:
    situacao: str  # novo | atualizado | igual
    edital_id: str
    versao: int
    arquivos_novos: list[str] = field(default_factory=list)


def ja_atualizado(conn: psycopg.Connection[Any], fonte_id: Any, compra: Compra) -> str | None:
    """Edital já conhecido cuja data de atualização na fonte não mudou: dispensa buscar itens e
    arquivos. Devolve o id (e marca a coleta) ou None."""
    if compra.atualizacao_global is None:
        return None
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select e.id from pub.editais e join pub.edital_versoes v "
            "on v.edital_id = e.id and v.versao = e.versao_atual "
            "where e.fonte_id = %s and e.id_externo = %s and v.conteudo ->> 'fonte_atualizacao' = %s",
            (fonte_id, compra.id_externo, str(compra.atualizacao_global)),
        )
        r = cur.fetchone()
        if r is None:
            return None
        cur.execute("update pub.editais set ultima_coleta_em = now() where id = %s", (r["id"],))
    conn.commit()
    return str(r["id"])


def _orgao(conn: psycopg.Connection[Any], c: Compra) -> Any:
    o = c.orgao
    with conn.cursor() as cur:
        cur.execute(
            "insert into pub.orgaos (cnpj, unidade_codigo, razao_social, esfera, uf, municipio, codigo_ibge) "
            "values (%s, %s, %s, %s, %s, %s, %s) on conflict (cnpj, unidade_codigo) do update set "
            "razao_social = excluded.razao_social, esfera = excluded.esfera, uf = excluded.uf, "
            "municipio = excluded.municipio, codigo_ibge = excluded.codigo_ibge returning id",
            (o.cnpj, o.unidade_codigo, o.razao_social, o.esfera, o.uf, o.municipio, o.codigo_ibge),
        )
        row = cur.fetchone()
    assert row is not None  # noqa: S101
    return row[0]


def _itens(conn: psycopg.Connection[Any], edital_id: Any, c: Compra, versao: int) -> None:
    for i in c.itens:
        conn.execute(
            "insert into pub.edital_itens (edital_id, tipo, numero_item, descricao, quantidade, "
            "unidade_medida, valor_unitario_estimado, valor_total_estimado, beneficio, situacao, "
            "versao_inicial) values (%s, 'item', %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "on conflict (edital_id, tipo, numero_item) do update set descricao = excluded.descricao, "
            "quantidade = excluded.quantidade, unidade_medida = excluded.unidade_medida, "
            "valor_unitario_estimado = excluded.valor_unitario_estimado, "
            "valor_total_estimado = excluded.valor_total_estimado, beneficio = excluded.beneficio, "
            "situacao = excluded.situacao, versao_final = null",
            (edital_id, i.numero_item, i.descricao, i.quantidade, i.unidade_medida,
             i.valor_unitario_estimado, i.valor_total_estimado, i.beneficio, i.situacao, versao),
        )  # fmt: skip
    # Item que sumiu na retificação fica registrado como retirado a partir desta versão.
    conn.execute(
        "update pub.edital_itens set versao_final = %s where edital_id = %s and tipo = 'item' "
        "and versao_final is null and numero_item <> all(%s)",
        (versao, edital_id, [i.numero_item for i in c.itens] or [-1]),
    )


def _arquivos(conn: psycopg.Connection[Any], edital_id: Any, c: Compra) -> list[str]:
    novos: list[str] = []
    for a in c.arquivos:
        with conn.cursor() as cur:
            cur.execute(
                "insert into pub.edital_arquivos (edital_id, tipo, titulo, url_origem) "
                "select %s, %s, %s, %s where not exists "
                "(select 1 from pub.edital_arquivos where edital_id = %s and url_origem = %s) returning id",
                (edital_id, a.tipo, a.titulo, a.url, edital_id, a.url),
            )
            r = cur.fetchone()
        if r:
            novos.append(str(r[0]))
    return novos


def gravar(conn: psycopg.Connection[Any], fonte_id: Any, c: Compra) -> Resultado:
    """Grava a compra completa (com itens e arquivos). Mesmo conteúdo não gera versão nova."""
    hash_novo = c.hash()
    orgao_id = _orgao(conn, c)
    conteudo = {**c.conteudo(), "fonte_atualizacao": str(c.atualizacao_global)}
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select e.id, e.versao_atual, e.hash_conteudo, v.conteudo as anterior from pub.editais e "
            "left join pub.edital_versoes v on v.edital_id = e.id and v.versao = e.versao_atual "
            "where e.fonte_id = %s and e.id_externo = %s for update of e",
            (fonte_id, c.id_externo),
        )
        atual = cur.fetchone()
    valores = [c.campos[k] for k in CAMPOS_EDITAL]
    if atual is None:
        cols = ", ".join(CAMPOS_EDITAL)
        marcas = ", ".join(["%s"] * len(CAMPOS_EDITAL))
        with conn.cursor() as cur:
            cur.execute(
                f"insert into pub.editais (fonte_id, id_externo, orgao_id, hash_conteudo, {cols}) "  # noqa: S608
                f"values (%s, %s, %s, %s, {marcas}) returning id",
                (fonte_id, c.id_externo, orgao_id, hash_novo, *valores),
            )
            row = cur.fetchone()
        assert row is not None  # noqa: S101
        edital_id, versao = row[0], 1
        conn.execute(
            "insert into pub.edital_versoes (edital_id, versao, hash_conteudo, campos_alterados, conteudo) "
            "values (%s, 1, %s, '{}', %s)",
            (edital_id, hash_novo, _json(conteudo)),
        )
        _itens(conn, edital_id, c, versao)
        novos = _arquivos(conn, edital_id, c)
        conn.execute(
            "insert into pub.edital_eventos (edital_id, tipo, versao) values (%s, 'novo', 1)",
            (edital_id,),
        )
        conn.commit()
        return Resultado("novo", str(edital_id), versao, novos)

    edital_id = atual["id"]
    if atual["hash_conteudo"] == hash_novo:
        conn.execute("update pub.editais set ultima_coleta_em = now() where id = %s", (edital_id,))
        conn.commit()
        return Resultado("igual", str(edital_id), atual["versao_atual"])

    versao = atual["versao_atual"] + 1
    antes = atual["anterior"] or {}
    antes_campos = antes.get("campos", {})
    alterados = [k for k in CAMPOS_EDITAL if dumps(c.campos[k]) != dumps(antes_campos.get(k))]
    if dumps(c.conteudo()["itens"]) != dumps(antes.get("itens")):
        alterados.append("itens")
    if dumps(c.conteudo()["arquivos"]) != dumps(antes.get("arquivos")):
        alterados.append("arquivos")
    sets = ", ".join(f"{k} = %s" for k in CAMPOS_EDITAL)
    conn.execute(
        f"update pub.editais set orgao_id = %s, hash_conteudo = %s, versao_atual = %s, "  # noqa: S608
        f"ultima_coleta_em = now(), {sets} where id = %s",
        (orgao_id, hash_novo, versao, *valores, edital_id),
    )
    conn.execute(
        "insert into pub.edital_versoes (edital_id, versao, hash_conteudo, campos_alterados, conteudo) "
        "values (%s, %s, %s, %s, %s)",
        (edital_id, versao, hash_novo, alterados, _json(conteudo)),
    )
    _itens(conn, edital_id, c, versao)
    novos = _arquivos(conn, edital_id, c)
    eventos = ["retificado"]
    if {"data_abertura_propostas", "data_encerramento_propostas", "data_sessao"} & set(alterados):
        eventos.append("data_alterada")
    if "situacao" in alterados:
        eventos.append("situacao_alterada")
    if novos:
        eventos.append("arquivo_novo")
    for e in eventos:
        conn.execute(
            "insert into pub.edital_eventos (edital_id, tipo, versao) values (%s, %s, %s)",
            (edital_id, e, versao),
        )
    conn.commit()
    return Resultado("atualizado", str(edital_id), versao, novos)
