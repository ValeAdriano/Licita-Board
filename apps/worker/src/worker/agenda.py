"""Job `calcular_prazos` (Fase 05): grava os eventos da agenda de um acompanhamento a partir de `rules/prazos.py`.

Quem calcula é SEMPRE o worker (a API só enfileira). Idempotente: rodar de novo regrava só o que a regra
produz e registra no histórico o que mudou. Decisão humana nunca é sobrescrita: um override manual de
data fica como está (o recálculo só avisa), e o status do evento não é tocado.
"""

import logging
from datetime import UTC, date, datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.rules.feriados import feriados_nacionais
from worker.rules.prazos import Regra, Resultado, calcular

log = logging.getLogger("worker.agenda")

DIAS_INTERNOS = (
    2  # padrão D-2 úteis (spec pergunta 8: por empresa, quando houver a tela de parâmetros)
)
DO_EDITAL = ("esclarecimento", "impugnacao")  # eventos criados ao confirmar a abertura
DE_FATO = (
    "resposta_administracao",
    "intencao_recurso",
    "razoes_recurso",
    "contrarrazoes",
    "regularizacao_fiscal_me_epp",
)


def garantir_feriados(conn: psycopg.Connection[Any], anos: range) -> int:
    """Grava os feriados nacionais (fixos e móveis) dos anos pedidos; idempotente."""
    n = 0
    for ano in anos:
        for f in feriados_nacionais(ano):
            cur = conn.execute(
                "insert into pub.feriados (data, nome, tipo, abrangencia, origem) "
                "values (%s, %s, %s, 'nacional', 'calculado') "
                "on conflict (data, abrangencia, coalesce(uf, ''), coalesce(codigo_ibge, '')) do nothing",
                (f.data, f.nome, f.tipo),
            )
            n += cur.rowcount
    conn.commit()
    return n


def _regras(conn: psycopg.Connection[Any], hoje: date) -> dict[str, tuple[Regra, str]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select distinct on (evento) id, evento, base, quantidade, unidade, sentido, limite_superior, artigo, "
            "prorrogavel, validada_por is not null as validada from pub.regras_prazo "
            "where vigente_de <= %s and (vigente_ate is null or vigente_ate >= %s) order by evento, vigente_de desc",
            (hoje, hoje),
        )
        linhas = cur.fetchall()
    return {
        r["evento"]: (
            Regra(r["evento"], r["base"], r["quantidade"], r["unidade"], r["sentido"], r["artigo"],
                  r["limite_superior"], r["prorrogavel"], r["validada"]),
            str(r["id"]),
        )
        for r in linhas
    }  # fmt: skip


def _nao_uteis(
    conn: psycopg.Connection[Any], uf: str | None, ibge: str | None, ini: date, fim: date
) -> tuple[dict[date, str], str | None]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select data, nome, abrangencia from pub.feriados where data between %s and %s and ("
            "abrangencia = 'nacional' or (abrangencia = 'uf' and uf = %s) or (abrangencia = 'municipio' and codigo_ibge = %s))",
            (ini, fim, uf, ibge),
        )
        linhas = cur.fetchall()
        cur.execute(
            "select count(*) as n from pub.feriados where abrangencia = 'municipio' and codigo_ibge = %s",
            (ibge,),
        )
        municipais = cur.fetchone()
    aviso = (
        None
        if municipais and municipais["n"]
        else "feriados municipais deste órgão não cadastrados: só nacionais e estaduais contaram"
    )
    return {r["data"]: r["nome"] for r in linhas}, aviso


def _gravar(
    conn: psycopg.Connection[Any], empresa_id: Any, acomp_id: Any, tipo: str, regra_id: str | None, base: datetime | None,
    res: Resultado, provisorio: bool, validada: bool, aviso: str | None, agora: datetime,
) -> bool:  # fmt: skip
    """Insere ou atualiza o evento. Devolve True se a data-limite mudou."""
    avisos = "; ".join([a for a in (*res.avisos, aviso) if a])[:500] or None
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id, data_limite_legal, origem_prazo from priv.agenda_eventos where acompanhamento_id = %s and tipo = %s for update",
            (acomp_id, tipo),
        )
        atual = cur.fetchone()
    if atual is None:
        cur2 = conn.execute(
            "insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, regra_id, base_data, data_limite_legal, "
            "data_interna_recomendada, origem_prazo, clausula_edital, provisorio, regra_validada, aviso_calculo, calculado_em) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
            (
                empresa_id,
                acomp_id,
                tipo,
                regra_id,
                base,
                res.limite,
                res.interna,
                res.origem,
                res.clausula,
                provisorio,
                validada,
                avisos,
                agora,
            ),
        )
        row = cur2.fetchone()
        assert row is not None  # noqa: S101
        conn.execute(
            "insert into priv.agenda_evento_historico (empresa_id, evento_id, campo, antes, depois, motivo) "
            "values (%s, %s, 'data_limite_legal', null, %s, 'cálculo inicial')",
            (empresa_id, row[0], str(res.limite)),
        )
        return True
    if atual["origem_prazo"] == "manual":  # override humano: não sobrescreve, só avisa
        conn.execute(
            "update priv.agenda_eventos set aviso_calculo = %s, calculado_em = %s where id = %s",
            (
                "prazo ajustado à mão: o recálculo não o alterou (confira se a base mudou)",
                agora,
                atual["id"],
            ),
        )
        return False
    mudou = bool(atual["data_limite_legal"] != res.limite)
    conn.execute(
        "update priv.agenda_eventos set regra_id = %s, base_data = %s, data_limite_legal = %s, data_interna_recomendada = %s, "
        "origem_prazo = %s, clausula_edital = %s, provisorio = %s, regra_validada = %s, aviso_calculo = %s, calculado_em = %s where id = %s",
        (
            regra_id,
            base,
            res.limite,
            res.interna,
            res.origem,
            res.clausula,
            provisorio,
            validada,
            avisos,
            agora,
            atual["id"],
        ),
    )
    if mudou:
        conn.execute(
            "insert into priv.agenda_evento_historico (empresa_id, evento_id, campo, antes, depois, motivo) "
            "values (%s, %s, 'data_limite_legal', %s, %s, 'recálculo')",
            (empresa_id, atual["id"], str(atual["data_limite_legal"]), str(res.limite)),
        )
    return mudou


def calcular_acompanhamento(
    conn: psycopg.Connection[Any], acompanhamento_id: str, agora: datetime | None = None
) -> int:
    """Devolve quantos eventos tiveram a data-limite criada ou alterada."""
    agora = agora or datetime.now(UTC)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select a.id, a.empresa_id, a.data_abertura, a.abertura_confirmada, a.prazo_esclarecimento_edital, "
            "a.prazo_impugnacao_edital, a.clausula_prazos, o.uf, o.codigo_ibge from priv.acompanhamentos a "
            "join pub.editais e on e.id = a.edital_id join pub.orgaos o on o.id = e.orgao_id "
            "where a.id = %s and a.deleted_at is null",
            (acompanhamento_id,),
        )
        a = cur.fetchone()
        if a is None:
            return 0
        cur.execute(
            "select tipo, base_data from priv.agenda_eventos where acompanhamento_id = %s and tipo = any(%s)",
            (acompanhamento_id, list(DE_FATO)),
        )
        fatos = cur.fetchall()
    abertura = a["data_abertura"]
    anos = [agora.year, agora.year + 1] + (
        [abertura.year - 1, abertura.year, abertura.year + 1] if abertura else []
    )
    garantir_feriados(conn, range(min(anos) - 1, max(anos) + 2))
    nao_uteis, aviso_municipal = _nao_uteis(
        conn, a["uf"], a["codigo_ibge"], date(min(anos) - 1, 1, 1), date(max(anos) + 1, 12, 31)
    )
    regras = _regras(conn, agora.date())
    mudaram = 0
    if abertura is not None:
        provisorio = not a["abertura_confirmada"]
        # A disputa em si: a data é a própria abertura, sem regra.
        disputa = Resultado(abertura, abertura, "regra", "Abertura da sessão",
                            None, () if a["abertura_confirmada"] else ("data sugerida pelo PNCP: confirme a abertura",))  # fmt: skip
        mudaram += _gravar(
            conn,
            a["empresa_id"],
            a["id"],
            "disputa",
            None,
            abertura,
            disputa,
            provisorio,
            True,
            None,
            agora,
        )
        edital_prazo = {
            "esclarecimento": a["prazo_esclarecimento_edital"],
            "impugnacao": a["prazo_impugnacao_edital"],
        }
        for tipo in DO_EDITAL:
            if tipo in regras:
                regra, rid = regras[tipo]
                res = calcular(
                    regra,
                    abertura,
                    nao_uteis,
                    abertura,
                    edital_prazo[tipo],
                    a["clausula_prazos"],
                    DIAS_INTERNOS,
                )
                mudaram += _gravar(
                    conn,
                    a["empresa_id"],
                    a["id"],
                    tipo,
                    rid,
                    abertura,
                    res,
                    provisorio,
                    regra.validada,
                    aviso_municipal,
                    agora,
                )
    for f in fatos:
        if f["tipo"] in regras and f["base_data"] is not None:
            regra, rid = regras[f["tipo"]]
            res = calcular(regra, f["base_data"], nao_uteis, abertura, None, None, DIAS_INTERNOS)
            mudaram += _gravar(
                conn,
                a["empresa_id"],
                a["id"],
                f["tipo"],
                rid,
                f["base_data"],
                res,
                False,
                regra.validada,
                aviso_municipal,
                agora,
            )
    conn.commit()
    log.info(
        "prazos calculados",
        extra={"ctx": {"acompanhamento": str(acompanhamento_id), "alterados": mudaram}},
    )
    return mudaram
