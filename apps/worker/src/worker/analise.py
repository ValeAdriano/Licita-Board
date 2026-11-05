"""Job `analisar_item` (Fase 06): monta a matriz requisito x produto de UMA análise.

Quem classifica é SEMPRE código puro (`rules/comparacao.py`, `rules/evidencia.py`): este módulo só lê o banco, monta os
valores, chama as regras e grava. Idempotente. A conferência da ficha técnica e a ressalva são decisões humanas gravadas
por função na API: aqui elas são LIDAS e preservadas, nunca sobrescritas. Mudou o resultado de algo que já estava
aprovado: a aprovação técnica cai (a pessoa precisa aprovar de novo).
"""

import hashlib
import logging
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.rules.comparacao import Requisito, Resultado, Unidade, Valor, classificar, resumo
from worker.rules.evidencia import contem, pagina_da_citacao

log = logging.getLogger("worker.analise")


def _unidades(conn: psycopg.Connection[Any]) -> dict[Any, Unidade]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("select id, simbolo, grandeza, fator_para_base, deslocamento from pub.unidades")
        return {
            r["id"]: Unidade(
                r["simbolo"],
                r["grandeza"],
                Decimal(r["fator_para_base"]),
                Decimal(r["deslocamento"]),
            )
            for r in cur.fetchall()
        }


def _texto(valor: Valor, u: Unidade | None) -> str:
    if valor.numero is not None:
        n = format(valor.numero.normalize(), "f")
        return f"{n} {u.simbolo}" if u else n
    if valor.booleano is not None:
        return "sim" if valor.booleano else "não"
    return valor.texto or ""


def _oferta(
    conn: psycopg.Connection[Any],
    produto: dict[str, Any],
    req: dict[str, Any],
    unidades: dict[Any, Unidade],
    attrs: dict[Any, dict[str, Any]],
) -> Valor | None:
    if req["atributo_id"] is not None:
        a = attrs.get(req["atributo_id"])
        if a is None:
            return None
        n = Decimal(a["valor_numero"]) if a["valor_numero"] is not None else None
        return Valor(n, a["valor_texto"], a["valor_booleano"], unidades.get(a["unidade_id"]))
    por_simbolo = {u.simbolo: u for u in unidades.values()}
    if req["tipo_exigencia"] == "garantia" and produto["garantia_meses"] is not None:
        return Valor(Decimal(produto["garantia_meses"]), unidade=por_simbolo.get("meses"))
    if req["tipo_exigencia"] == "prazo_entrega" and produto["prazo_entrega_dias"] is not None:
        return Valor(Decimal(produto["prazo_entrega_dias"]), unidade=por_simbolo.get("dias"))
    return None


def _requisito(req: dict[str, Any], unidades: dict[Any, Unidade]) -> Requisito:
    u = unidades.get(req["unidade_id"])

    def val(n: Any) -> Valor | None:
        return None if n is None else Valor(numero=Decimal(n), unidade=u)

    valor = val(req["valor_numero"])
    if valor is None and req["valor_texto"]:
        valor = Valor(texto=req["valor_texto"])
    return Requisito(req["operador"], valor, val(req["valor_max"]), req["obrigatorio"])


def analisar(conn: psycopg.Connection[Any], analise_id: str, empresa_job: Any = None) -> str | None:
    """Devolve o resumo do item, ou None se a análise não existe (ou não é da empresa do job)."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select a.id, a.empresa_id, a.participacao_id, a.produto_id, a.hash_resultado, a.aprovado_por, ac.edital_id "
            "from priv.analises_item a join priv.participacoes p on p.id = a.participacao_id "
            "join priv.acompanhamentos ac on ac.id = p.acompanhamento_id where a.id = %s",
            (analise_id,),
        )
        a = cur.fetchone()
        if a is None or (empresa_job is not None and str(a["empresa_id"]) != str(empresa_job)):
            return None  # nunca confie no payload: a análise tem de ser da empresa do job (T2)
        cur.execute(
            "select id, nome, tipo_exigencia, atributo_id, operador, valor_numero, valor_max, valor_texto, unidade_id, obrigatorio, "
            "citacao_edital, pagina, origem, confirmado_em from priv.requisitos_item where participacao_id = %s and empresa_id = %s and deleted_at is null order by created_at, id",
            (a["participacao_id"], a["empresa_id"]),
        )
        reqs = cur.fetchall()
        cur.execute(
            "select id, garantia_meses, prazo_entrega_dias from priv.produtos where id = %s and empresa_id = %s",
            (a["produto_id"], a["empresa_id"]),
        )
        produto = cur.fetchone() or {"garantia_meses": None, "prazo_entrega_dias": None}
        cur.execute(
            "select atributo_id, valor_numero, valor_texto, valor_booleano, unidade_id from priv.produto_atributos where produto_id = %s and empresa_id = %s",
            (a["produto_id"], a["empresa_id"]),
        )
        attrs = {r["atributo_id"]: r for r in cur.fetchall()}
        cur.execute(
            "select requisito_id, ficha_conferida_por, ressalva from priv.analise_linhas where analise_id = %s and empresa_id = %s",
            (a["id"], a["empresa_id"]),
        )
        antes = {r["requisito_id"]: r for r in cur.fetchall()}
        paginas: dict[int, str] = {}
        if any(r["citacao_edital"] for r in reqs):
            cur.execute(
                "select pagina, texto from pub.trechos where edital_id = %s order by pagina, ordem",
                (a["edital_id"],),
            )
            for r in cur.fetchall():
                paginas[r["pagina"]] = f"{paginas.get(r['pagina'], '')}\n{r['texto']}"
    unidades = _unidades(conn)
    resultados: list[tuple[bool, Resultado]] = []
    assinatura: list[str] = []
    for r in reqs:
        requisito = _requisito(r, unidades)
        oferta = _oferta(conn, produto, r, unidades, attrs)
        citacao = r["citacao_edital"]
        pagina_ok: int | None = None
        if citacao:
            if r["pagina"] is not None:
                pagina_ok = r["pagina"] if contem(citacao, paginas.get(r["pagina"], "")) else None
            else:
                pagina_ok = pagina_da_citacao(citacao, paginas)
        ant = antes.get(r["id"])
        sem_vinculo = r["atributo_id"] is None and r["tipo_exigencia"] not in (
            "garantia",
            "prazo_entrega",
        )
        if r["origem"] == "ia" and r["confirmado_em"] is None:
            from worker.rules.comparacao import Classificacao  # noqa: PLC0415

            c = Classificacao(
                Resultado.A_CONFIRMAR,
                "Requisito sugerido pela IA: confira o texto e a citação e confirme (ou remova).",
                "A IA só sugere; a pessoa confirma.",
            )
        elif sem_vinculo:
            from worker.rules.comparacao import Classificacao  # noqa: PLC0415

            c = Classificacao(
                Resultado.A_CONFIRMAR,
                "Vincule este requisito a um atributo do catálogo do produto (ou use garantia/prazo de entrega).",
                "Sem atributo para comparar.",
            )
        else:
            c = classificar(
                requisito, oferta, citacao_edital_ok=pagina_ok is not None,
                ficha_conferida=bool(ant and ant["ficha_conferida_por"]), ressalva=(ant or {}).get("ressalva"),
            )  # fmt: skip
        oferecido = _texto(oferta, oferta.unidade) if oferta else None
        conn.execute(
            "insert into priv.analise_linhas (empresa_id, analise_id, requisito_id, resultado, valor_oferecido, citacao_verificada, pagina_edital, "
            "justificativa, pendencia, calculado_em) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, now()) "
            "on conflict (analise_id, requisito_id) do update set resultado = excluded.resultado, valor_oferecido = excluded.valor_oferecido, "
            "citacao_verificada = excluded.citacao_verificada, pagina_edital = excluded.pagina_edital, justificativa = excluded.justificativa, "
            "pendencia = excluded.pendencia, calculado_em = now()",
            (
                a["empresa_id"],
                a["id"],
                r["id"],
                c.resultado.value,
                oferecido,
                pagina_ok is not None,
                pagina_ok,
                c.justificativa,
                c.pendencia,
            ),
        )
        resultados.append((bool(r["obrigatorio"]), c.resultado))
        assinatura.append(f"{r['id']}:{c.resultado.value}:{oferecido}")
    s = resumo(resultados)
    h = hashlib.sha256("|".join(assinatura).encode()).hexdigest()
    mudou = h != a["hash_resultado"]
    conn.execute(
        "update priv.analises_item set resumo = %s, hash_resultado = %s, calculado_em = now(), "
        "aprovado_por = case when %s then null else aprovado_por end, aprovado_em = case when %s then null else aprovado_em end, "
        "aprovado_resumo = case when %s then null else aprovado_resumo end where id = %s",
        (s, h, mudou, mudou, mudou, a["id"]),
    )
    conn.commit()
    log.info(
        "análise calculada",
        extra={"ctx": {"analise": str(a["id"]), "resumo": s, "requisitos": len(reqs)}},
    )
    return s
