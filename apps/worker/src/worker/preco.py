"""Job `calcular_preco` (Fase 07): lê os insumos de UMA precificação e grava o resultado calculado por `rules/precos.py`.

Quem calcula é SEMPRE código puro (Decimal); este módulo só lê, chama e grava. Idempotente. Entrada que não permite
calcular (ex.: percentuais que somam 100%) grava a mensagem em `erro_calculo` para a pessoa corrigir, e o resultado fica
vazio (a aprovação exige resultado sem erro). Custos e margens são sigilo comercial: nada disto vai para log.
"""

import logging
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.rules.precos import Entrada, ErroPreco, Linha, calcular

log = logging.getLogger("worker.preco")


def calcular_precificacao(
    conn: psycopg.Connection[Any], precificacao_id: str, empresa_job: Any = None
) -> bool | None:
    """True se calculou, False se a entrada era inválida (erro gravado), None se não existe/não é da empresa do job."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id, empresa_id, quantidade, valor_estimado_unit, margem_desejada_pct, margem_minima_pct, casas_unitario, arredondamento, "
            "preco_proposto_unit, limite_inexequivel_pct from priv.precificacoes where id = %s and deleted_at is null",
            (precificacao_id,),
        )
        p = cur.fetchone()
        if p is None or (empresa_job is not None and str(p["empresa_id"]) != str(empresa_job)):
            return None  # nunca confie no payload: a precificação tem de ser da empresa do job (T2)
        cur.execute(
            "select categoria, forma, valor, percentual from priv.preco_linhas where precificacao_id = %s and empresa_id = %s and deleted_at is null",
            (p["id"], p["empresa_id"]),
        )
        linhas = tuple(
            Linha(
                "custo" if r["categoria"] == "custo" else "percentual",
                r["forma"],
                r["valor"],
                r["percentual"],
            )
            for r in cur.fetchall()
        )
    try:
        r = calcular(
            Entrada(
                quantidade=Decimal(p["quantidade"]), linhas=linhas, margem_desejada_pct=Decimal(p["margem_desejada_pct"]),
                margem_minima_pct=Decimal(p["margem_minima_pct"]), casas=p["casas_unitario"], modo=p["arredondamento"],
                preco_proposto=p["preco_proposto_unit"], valor_estimado_unit=p["valor_estimado_unit"],
                limite_inexequivel_pct=p["limite_inexequivel_pct"],
            )
        )  # fmt: skip
    except ErroPreco as e:
        conn.execute(
            "update priv.precificacoes set erro_calculo = %s, calculado_em = now(), custo_direto_unit = null, percentuais_sobre_preco = null, "
            "preco_minimo_unit = null, preco_oferta_unit = null, preco_final_unit = null, total_proposta = null, margem_bruta_pct = null, "
            "margem_liquida_pct = null, diferenca_estimado_pct = null, abaixo_do_minimo = null, risco_inexequivel = null where id = %s",
            (str(e), p["id"]),
        )
        conn.commit()
        log.info("precificação com entrada inválida", extra={"ctx": {"precificacao": str(p["id"])}})
        return False
    conn.execute(
        "update priv.precificacoes set erro_calculo = null, calculado_em = now(), custo_direto_unit = %s, percentuais_sobre_preco = %s, "
        "preco_minimo_unit = %s, preco_oferta_unit = %s, preco_final_unit = %s, total_proposta = %s, margem_bruta_pct = %s, margem_liquida_pct = %s, "
        "diferenca_estimado_pct = %s, abaixo_do_minimo = %s, risco_inexequivel = %s where id = %s",
        (
            r.custo_direto_unit, r.percentuais_sobre_preco, r.preco_minimo_unit, r.preco_oferta_unit, r.preco_final_unit, r.total_proposta,
            r.margem_bruta_pct, r.margem_liquida_pct, r.diferenca_estimado_pct, r.abaixo_do_minimo, r.risco_inexequivel, p["id"],
        ),
    )  # fmt: skip
    conn.commit()
    log.info("preço calculado", extra={"ctx": {"precificacao": str(p["id"])}})
    return True
