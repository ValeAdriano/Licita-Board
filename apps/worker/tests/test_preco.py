"""Job calcular_preco com banco (VV_ADMIN_URL_TEST): resultado gravado em Decimal, erro de entrada, empresa do job."""

import os
import uuid
from decimal import Decimal as D
from typing import Any

import psycopg
import pytest

from tests.test_coleta import _admin
from worker.preco import calcular_precificacao

pytestmark = pytest.mark.skipif(
    not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste"
)


@pytest.fixture
def cena() -> Any:
    assert _admin("select current_database()")[0][0] != "vv"
    emp = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, 'Preço Teste', '11222333000181')",
        emp,
    )
    fonte = _admin("select id from ops.fontes where slug = 'pncp'")[0][0]
    org = _admin(
        "insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values (%s, 'Órgão', 'PR', '4106902') returning id",
        f"{uuid.uuid4().int % 10**14:014d}",
    )[0][0]
    ed = _admin(
        "insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) values (%s, %s, %s, 'x', repeat('a', 64)) returning id",
        fonte, f"PR-{uuid.uuid4()}", org,
    )[0][0]  # fmt: skip
    item = _admin(
        "insert into pub.edital_itens (edital_id, numero_item, descricao) values (%s, 1, 'Item') returning id",
        ed,
    )[0][0]
    ac = _admin(
        "insert into priv.acompanhamentos (empresa_id, edital_id) values (%s, %s) returning id",
        emp,
        ed,
    )[0][0]
    part = _admin(
        "insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values (%s, %s, %s) returning id",
        emp,
        ac,
        item,
    )[0][0]
    prec = _admin(
        "insert into priv.precificacoes (empresa_id, participacao_id, quantidade, margem_desejada_pct, margem_minima_pct, valor_estimado_unit, limite_inexequivel_pct) "
        "values (%s, %s, 10, 20, 10, 200, 70) returning id",
        emp, part,
    )[0][0]  # fmt: skip
    _admin(
        "insert into priv.preco_linhas (empresa_id, precificacao_id, nome, tipo, categoria, forma, valor) values (%s, %s, 'Aquisição', 'aquisicao', 'custo', 'por_unidade', 100)",
        emp, prec,
    )  # fmt: skip
    conn = psycopg.connect(os.environ["VV_ADMIN_URL_TEST"])
    conn.execute("set role vv_worker")
    conn.commit()
    yield {"conn": conn, "emp": emp, "prec": str(prec)}
    conn.close()
    _admin("delete from priv.preco_linhas")
    _admin("delete from priv.precificacoes")
    _admin("delete from priv.participacoes")
    _admin("delete from priv.acompanhamentos")
    _admin("alter table core.empresas disable trigger user")
    _admin("delete from core.empresas where id = %s", emp)
    _admin("alter table core.empresas enable trigger user")


def _res(c: dict[str, Any]) -> Any:
    return _admin(
        "select preco_minimo_unit, preco_oferta_unit, preco_final_unit, total_proposta, margem_bruta_pct, abaixo_do_minimo, risco_inexequivel, erro_calculo "
        "from priv.precificacoes where id = %s",
        c["prec"],
    )[0]


def test_grava_o_resultado_em_decimal(cena: Any) -> None:
    assert calcular_precificacao(cena["conn"], cena["prec"], cena["emp"]) is True
    minimo, oferta, final, total, bruta, abaixo, risco, erro = _res(cena)
    assert (minimo, oferta, final, total) == (
        D("111.120000"),
        D("125.000000"),
        D("125.000000"),
        D("1250.0000"),
    )
    assert (
        bruta == D("20.0000") and abaixo is False and risco == "RISCO" and erro is None
    )  # 125 < 70% de 200


def test_alterar_a_quantidade_atualiza_o_total(cena: Any) -> None:
    calcular_precificacao(cena["conn"], cena["prec"], cena["emp"])
    _admin("update priv.precificacoes set quantidade = 25 where id = %s", cena["prec"])
    calcular_precificacao(cena["conn"], cena["prec"], cena["emp"])
    assert _res(cena)[3] == D("3125.0000")


def test_preco_proposto_abaixo_do_minimo_e_marcado(cena: Any) -> None:
    _admin("update priv.precificacoes set preco_proposto_unit = 105 where id = %s", cena["prec"])
    calcular_precificacao(cena["conn"], cena["prec"], cena["emp"])
    assert _res(cena)[5] is True


def test_entrada_invalida_grava_o_erro_e_limpa_o_resultado(cena: Any) -> None:
    calcular_precificacao(cena["conn"], cena["prec"], cena["emp"])
    _admin(
        "insert into priv.preco_linhas (empresa_id, precificacao_id, nome, tipo, categoria, percentual) values (%s, %s, 'Tributos', 'tributo', 'percentual', 85)",
        cena["emp"], cena["prec"],
    )  # fmt: skip
    assert (
        calcular_precificacao(cena["conn"], cena["prec"], cena["emp"]) is False
    )  # 85% + 20% de margem
    r = _res(cena)
    assert r[2] is None and "100%" in r[7]


def test_precificacao_de_outra_empresa_e_ignorada(cena: Any) -> None:
    assert calcular_precificacao(cena["conn"], cena["prec"], str(uuid.uuid4())) is None
    assert _res(cena)[2] is None  # nada foi calculado
