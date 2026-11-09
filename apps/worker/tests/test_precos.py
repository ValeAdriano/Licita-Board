from decimal import Decimal as D

import pytest

from worker.rules.precos import (
    Entrada,
    ErroPreco,
    Linha,
    arredondar,
    calcular,
    empate_ficto,
    estatistica_historico,
)


def custo(v: str, forma: str = "por_unidade") -> Linha:
    return Linha("custo", forma, D(v))


def pct(v: str) -> Linha:
    return Linha("percentual", percentual=D(v))


def entrada(**kw: object) -> Entrada:
    base: dict[str, object] = {
        "quantidade": D(10), "linhas": (custo("100"),), "margem_desejada_pct": D(20), "margem_minima_pct": D(10),
    }  # fmt: skip
    base.update(kw)
    return Entrada(**base)  # type: ignore[arg-type]


def test_preco_com_margem_sobre_o_preco() -> None:
    r = calcular(entrada())
    assert r.custo_direto_unit == D("100.000000")
    assert r.preco_oferta_unit == D("125.00")  # 100 / (1 - 0,20)
    assert r.preco_minimo_unit == D(
        "111.12"
    )  # 100 / 0,9 = 111,111...: arredonda PARA CIMA (cobre o custo)
    assert r.total_proposta == D("1250.00")
    assert r.margem_bruta_pct == D("20.0000")
    assert r.margem_liquida_pct == D("20.0000")


def test_percentuais_sobre_o_preco_entram_no_divisor() -> None:
    r = calcular(entrada(linhas=(custo("100"), pct("6"), pct("4")), margem_desejada_pct=D(10)))
    assert r.percentuais_sobre_preco == D("10.0000")
    assert r.preco_oferta_unit == D("125.00")  # 100 / (1 - 0,10 - 0,10)
    assert r.margem_bruta_pct == D("20.0000")
    assert r.margem_liquida_pct == D("10.0000")  # a margem líquida volta ao desejado: a conta fecha


def test_custo_do_lote_divide_pela_quantidade_e_alterar_quantidade_atualiza_os_totais() -> None:
    linhas = (custo("50"), custo("500", "total_lote"))
    r10 = calcular(entrada(linhas=linhas, margem_desejada_pct=D(0), margem_minima_pct=D(0)))
    assert r10.custo_direto_unit == D("100.000000")
    r20 = calcular(
        entrada(linhas=linhas, quantidade=D(20), margem_desejada_pct=D(0), margem_minima_pct=D(0))
    )
    assert r20.custo_direto_unit == D("75.000000")  # o lote rateia por mais unidades
    assert r20.total_proposta == D("1500.00")
    assert r10.total_proposta == D("1000.00")


def test_preco_proposto_prevalece_e_abaixo_do_minimo_e_sinalizado() -> None:
    r = calcular(entrada(preco_proposto=D("105")))
    assert r.preco_final_unit == D("105.00")
    assert r.abaixo_do_minimo is True
    assert r.total_proposta == D("1050.00")
    assert calcular(entrada(preco_proposto=D("112"))).abaixo_do_minimo is False


def test_total_e_quantidade_vezes_unitario_arredondado() -> None:
    r = calcular(
        entrada(
            quantidade=D("3"),
            linhas=(custo("33.333"),),
            margem_desejada_pct=D(0),
            margem_minima_pct=D(0),
        )
    )
    assert r.preco_final_unit == D("33.33")  # unitário arredondado a 2 casas
    assert r.total_proposta == D("99.99")  # 3 × 33,33, e não 3 × 33,333


@pytest.mark.parametrize(
    ("valor", "casas", "modo", "esperado"),
    [
        ("1.005", 2, "half_up", "1.01"),  # sem erro de ponto flutuante: 1,005 arredonda para 1,01
        ("1.005", 2, "truncar", "1.00"),
        ("2.5555", 3, "half_up", "2.556"),
        ("2.5559", 3, "truncar", "2.555"),
        ("0.9999995", 6, "half_up", "1.000000"),
    ],
)
def test_arredondamento_por_edital(valor: str, casas: int, modo: str, esperado: str) -> None:
    assert arredondar(D(valor), casas, modo) == D(esperado)


def test_casas_e_modo_invalidos() -> None:
    with pytest.raises(ErroPreco):
        arredondar(D(1), 1, "half_up")
    with pytest.raises(ErroPreco):
        arredondar(D(1), 7, "half_up")
    with pytest.raises(ErroPreco):
        arredondar(D(1), 2, "banqueiro")


def test_diferenca_para_o_estimado_e_inexequibilidade_parametrizada() -> None:
    r = calcular(entrada(valor_estimado_unit=D("200"), limite_inexequivel_pct=D("70")))
    assert r.diferenca_estimado_pct == D("-37.5000")  # 125 contra 200
    assert r.risco_inexequivel == "RISCO"  # 125 < 70% de 200 = 140
    assert (
        calcular(
            entrada(valor_estimado_unit=D("150"), limite_inexequivel_pct=D("70"))
        ).risco_inexequivel
        == "OK"
    )
    assert (
        calcular(entrada(valor_estimado_unit=D("200"))).risco_inexequivel == "NAO_PARAMETRIZADO"
    )  # sem critério, nada é suposto
    assert calcular(entrada()).diferenca_estimado_pct is None


def test_entradas_invalidas() -> None:
    with pytest.raises(ErroPreco):
        calcular(entrada(quantidade=D(0)))
    with pytest.raises(ErroPreco):
        calcular(entrada(margem_desejada_pct=D(-1)))
    with pytest.raises(ErroPreco):
        calcular(
            entrada(linhas=(custo("100"), pct("90")), margem_desejada_pct=D(10))
        )  # 90 + 10 = 100%
    with pytest.raises(ErroPreco):
        calcular(entrada(linhas=(Linha("percentual", percentual=None),)))
    with pytest.raises(ErroPreco):
        calcular(entrada(linhas=(Linha("custo", "por_unidade", D(-1)),)))
    with pytest.raises(ErroPreco):
        calcular(entrada(linhas=(Linha("custo", "mensal", D(1)),)))
    with pytest.raises(ErroPreco):
        calcular(entrada(linhas=(Linha("imposto", valor=D(1)),)))


def test_sem_linhas_de_custo_o_preco_e_zero_e_nao_divide_por_zero() -> None:
    r = calcular(entrada(linhas=()))
    assert r.preco_final_unit == D("0.00")
    assert r.margem_bruta_pct == D("0.0000")


def test_empate_ficto() -> None:
    assert empate_ficto(D("1000.00"), D("1050.00"), D(5)) == (
        True,
        D("1050.00"),
    )  # exatamente no limite
    assert empate_ficto(D("1000.00"), D("1050.01"), D(5)) == (False, D("1050.00"))
    assert empate_ficto(D("1000.00"), D("999.99"), D(5))[0] is False  # já é a melhor
    assert empate_ficto(D("1000.00"), D("1000.00"), D(5))[0] is False  # igual: não é "acima"
    assert empate_ficto(D("1000.00"), D("1090.00"), D(10))[0] is True
    with pytest.raises(ErroPreco):
        empate_ficto(D(0), D(1), D(5))
    with pytest.raises(ErroPreco):
        empate_ficto(D(1), D(1), D(-5))


def test_estatistica_historico_mesma_unidade_e_unidades_diferentes() -> None:
    assert estatistica_historico([]) is None
    assert estatistica_historico([(None, "UN"), (D("-1"), "UN")]) is None
    # Unidades diferentes -> None (RF-07.13)
    assert estatistica_historico([(D("10"), "UN"), (D("20"), "CX")]) is None

    # Mediana discreta (percentile_disc(0.5)) com n par e ímpar e diferença contra nosso preço
    est_impar = estatistica_historico(
        [(D("800"), "un"), (D("700"), "UN"), (D("900"), None)],
        nosso_preco_unit=D("770"),
    )
    assert est_impar is not None
    assert (
        est_impar.n,
        est_impar.minimo,
        est_impar.mediana,
        est_impar.maximo,
        est_impar.unidade,
    ) == (
        3,
        D("700.0000"),
        D("800.0000"),
        D("900.0000"),
        "UN",
    )
    assert est_impar.diferenca_nosso_pct == D("-3.7500")

    est_par = estatistica_historico(
        [(D("100"), "KG"), (D("200"), "kg"), (D("300"), "KG"), (D("400"), "KG")]
    )
    assert est_par is not None
    assert est_par.mediana == D("200.0000")  # (4 - 1) // 2 = índice 1, valor real da amostra
    assert est_par.diferenca_nosso_pct is None
