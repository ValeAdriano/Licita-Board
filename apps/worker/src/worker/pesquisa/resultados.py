"""Coleta e persistência idempotente de resultados de itens do PNCP (Fase 07, Bloco 7.5)."""

import datetime as dt
import re
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.connectors.pncp import ConectorPNCP, Http, ResultadoItem, dumps

_RE_LINK = re.compile(r"/editais/([0-9A-Za-z]{14})/(\d{4})/(\d+)")
_RE_ID_EXT = re.compile(r"^([0-9A-Za-z]{14})-\d+-(\d+)/(\d{4})$")


def extrair_endereco_pncp(id_externo: str, link_origem: str | None) -> tuple[str, int, int] | None:
    """Extrai (cnpj, ano, sequencial) do link_origem ou do numeroControlePNCP."""
    if link_origem and (m := _RE_LINK.search(link_origem)):
        return m.group(1), int(m.group(2)), int(m.group(3))
    if m := _RE_ID_EXT.match(id_externo.strip()):
        return m.group(1), int(m.group(3)), int(m.group(2))
    return None


def gravar_resultado_item(
    conn: psycopg.Connection[Any],
    destino: tuple[str, str, str, str],
    r: ResultadoItem,
) -> str:
    """Grava ou atualiza um resultado em `pub.precos_historicos` com histórico de versões."""
    fonte_id, edital_id, edital_item_id, link_origem = destino
    novo_hash = r.hash()
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select * from pub.precos_historicos where fonte_id = %s and id_externo = %s",
            (fonte_id, r.id_externo),
        )
        atual = cur.fetchone()
        if atual is None:
            cur.execute(
                """
                insert into pub.precos_historicos (
                  fonte_id, id_externo, edital_id, edital_item_id,
                  fornecedor_tipo, fornecedor_cnpj, fornecedor_nome, fornecedor_porte,
                  beneficio_me_epp, marca, modelo, quantidade, unidade_medida,
                  valor_unitario, valor_total, percentual_desconto, classificacao,
                  data_resultado, situacao, cancelado, hash_conteudo, versao, link_origem
                ) values (
                  %s, %s, %s, %s,
                  %s, %s, %s, %s,
                  %s, %s, %s, %s, %s,
                  %s, %s, %s, %s,
                  %s, %s, %s, %s, 1, %s
                )
                """,
                (
                    fonte_id,
                    r.id_externo,
                    edital_id,
                    edital_item_id,
                    r.fornecedor_tipo,
                    r.fornecedor_cnpj,
                    r.fornecedor_nome,
                    r.fornecedor_porte,
                    r.beneficio_me_epp,
                    r.marca,
                    r.modelo,
                    r.quantidade,
                    r.unidade_medida,
                    r.valor_unitario,
                    r.valor_total,
                    r.percentual_desconto,
                    r.classificacao,
                    r.data_resultado,
                    r.situacao,
                    r.cancelado,
                    novo_hash,
                    link_origem,
                ),
            )
            return "novo"

        if atual["hash_conteudo"] == novo_hash:
            cur.execute(
                "update pub.precos_historicos set ultima_coleta_em = now() where id = %s",
                (atual["id"],),
            )
            return "inalterado"

        campos_comparaveis = (
            "fornecedor_tipo",
            "fornecedor_cnpj",
            "fornecedor_nome",
            "fornecedor_porte",
            "beneficio_me_epp",
            "marca",
            "modelo",
            "quantidade",
            "unidade_medida",
            "valor_unitario",
            "valor_total",
            "percentual_desconto",
            "classificacao",
            "situacao",
            "cancelado",
        )
        alterados = [c for c in campos_comparaveis if getattr(r, c) != atual.get(c)]
        if not alterados:
            alterados = ["data_resultado"]
        conteudo_anterior = {c: atual.get(c) for c in campos_comparaveis}
        conteudo_anterior["data_resultado"] = (
            atual["data_resultado"].isoformat() if atual.get("data_resultado") else None
        )
        cur.execute(
            """
            insert into pub.preco_historico_versoes (
              preco_historico_id, versao, hash_conteudo, campos_alterados, conteudo
            ) values (%s, %s, %s, %s, %s::jsonb)
            """,
            (
                atual["id"],
                atual["versao"],
                atual["hash_conteudo"],
                alterados,
                dumps(conteudo_anterior),
            ),
        )
        cur.execute(
            """
            update pub.precos_historicos
               set fornecedor_tipo = %s,
                   fornecedor_cnpj = %s,
                   fornecedor_nome = %s,
                   fornecedor_porte = %s,
                   beneficio_me_epp = %s,
                   marca = %s,
                   modelo = %s,
                   quantidade = %s,
                   unidade_medida = %s,
                   valor_unitario = %s,
                   valor_total = %s,
                   percentual_desconto = %s,
                   classificacao = %s,
                   data_resultado = %s,
                   situacao = %s,
                   cancelado = %s,
                   hash_conteudo = %s,
                   versao = versao + 1,
                   ultima_coleta_em = now()
             where id = %s
            """,
            (
                r.fornecedor_tipo,
                r.fornecedor_cnpj,
                r.fornecedor_nome,
                r.fornecedor_porte,
                r.beneficio_me_epp,
                r.marca,
                r.modelo,
                r.quantidade,
                r.unidade_medida,
                r.valor_unitario,
                r.valor_total,
                r.percentual_desconto,
                r.classificacao,
                r.data_resultado,
                r.situacao,
                r.cancelado,
                novo_hash,
                atual["id"],
            ),
        )
        return "atualizado"


def coletar_edital(
    conn: psycopg.Connection[Any],
    edital_id: str,
    http: Http,
    agora: dt.datetime | None = None,
    revisita_dias: int = 7,
) -> dict[str, int]:
    """Coleta os resultados dos itens de um edital do PNCP e atualiza `ops.resultado_coletas`."""
    instante = agora or dt.datetime.now(dt.UTC)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id, fonte_id, id_externo, link_origem from pub.editais where id = %s",
            (edital_id,),
        )
        ed = cur.fetchone()
        if ed is None:
            return {"itens_total": 0, "itens_com_resultado": 0, "novos": 0, "atualizados": 0}
        cur.execute(
            "select id, numero_item, unidade_medida from pub.edital_itens "
            "where edital_id = %s and tipo = 'item' order by numero_item",
            (edital_id,),
        )
        itens = cur.fetchall()

    endereco = extrair_endereco_pncp(str(ed["id_externo"]), ed.get("link_origem"))
    if endereco is None:
        return {"itens_total": len(itens), "itens_com_resultado": 0, "novos": 0, "atualizados": 0}
    cnpj, ano, seq = endereco
    link_origem = str(
        ed.get("link_origem") or f"https://pncp.gov.br/app/editais/{cnpj}/{ano}/{seq}"
    )
    conector = ConectorPNCP(http)

    novos = 0
    atualizados = 0
    itens_com_resultado = 0

    for item in itens:
        resultados = conector.listar_resultados_item(
            endereco,
            int(item["numero_item"]),
            str(ed["id_externo"]),
            item.get("unidade_medida"),
        )
        if resultados:
            itens_com_resultado += 1
        for res in resultados:
            acao = gravar_resultado_item(
                conn,
                (str(ed["fonte_id"]), str(ed["id"]), str(item["id"]), link_origem),
                res,
            )
            if acao == "novo":
                novos += 1
            elif acao == "atualizado":
                atualizados += 1

    total = len(itens)
    if total > 0 and itens_com_resultado >= total:
        status = "completo"
    elif itens_com_resultado > 0:
        status = "parcial"
    else:
        status = "aguardando"

    proxima = instante + dt.timedelta(days=revisita_dias)
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into ops.resultado_coletas (
              edital_id, ultima_verificacao_em, proxima_verificacao_em,
              itens_total, itens_com_resultado, status, erro_tipo, falhas_consecutivas
            ) values (%s, %s, %s, %s, %s, %s, null, 0)
            on conflict (edital_id) do update
               set ultima_verificacao_em = excluded.ultima_verificacao_em,
                   proxima_verificacao_em = excluded.proxima_verificacao_em,
                   itens_total = excluded.itens_total,
                   itens_com_resultado = excluded.itens_com_resultado,
                   status = excluded.status,
                   erro_tipo = null,
                   falhas_consecutivas = 0
            """,
            (edital_id, instante, proxima, total, itens_com_resultado, status),
        )
    conn.commit()
    return {
        "itens_total": total,
        "itens_com_resultado": itens_com_resultado,
        "novos": novos,
        "atualizados": atualizados,
    }
