from decimal import Decimal as D

import pytest

from worker.rules.extenso import inteiro_por_extenso, reais_por_extenso


@pytest.mark.parametrize(
    ("n", "esperado"),
    [
        (0, "zero"), (1, "um"), (10, "dez"), (11, "onze"), (19, "dezenove"), (20, "vinte"), (21, "vinte e um"), (99, "noventa e nove"),
        (100, "cem"), (101, "cento e um"), (110, "cento e dez"), (200, "duzentos"), (999, "novecentos e noventa e nove"),
        (1000, "mil"), (1001, "mil e um"), (1100, "mil e cem"), (1500, "mil e quinhentos"), (1234, "mil duzentos e trinta e quatro"),
        (2000, "dois mil"), (2003, "dois mil e três"), (21_000, "vinte e um mil"), (100_000, "cem mil"), (101_000, "cento e um mil"),
        (123_456, "cento e vinte e três mil quatrocentos e cinquenta e seis"),
        (1_000_000, "um milhão"), (2_000_000, "dois milhões"), (1_000_001, "um milhão e um"), (1_500_000, "um milhão e quinhentos mil"),
        (2_345_678, "dois milhões trezentos e quarenta e cinco mil seiscentos e setenta e oito"),
        (1_000_000_000, "um bilhão"), (3_000_000_000_000, "três trilhões"),
    ],
)  # fmt: skip
def test_inteiros(n: int, esperado: str) -> None:
    assert inteiro_por_extenso(n) == esperado


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        ("0.00", "zero reais"),
        ("0.01", "um centavo"),
        ("0.50", "cinquenta centavos"),
        ("1.00", "um real"),
        ("1.01", "um real e um centavo"),
        ("2.00", "dois reais"),
        ("1234.56", "mil duzentos e trinta e quatro reais e cinquenta e seis centavos"),
        ("100.00", "cem reais"),
        ("1000000.00", "um milhão de reais"),
        ("2000000.00", "dois milhões de reais"),
        ("1000000.01", "um milhão de reais e um centavo"),
        ("1000001.00", "um milhão e um reais"),
        ("1500000.00", "um milhão e quinhentos mil reais"),
        ("89937.74", "oitenta e nove mil novecentos e trinta e sete reais e setenta e quatro centavos"),
        ("999999999999999.99", "novecentos e noventa e nove trilhões novecentos e noventa e nove bilhões novecentos e noventa e nove milhões novecentos e noventa e nove mil novecentos e noventa e nove reais e noventa e nove centavos"),
    ],
)  # fmt: skip
def test_reais(valor: str, esperado: str) -> None:
    assert reais_por_extenso(D(valor)) == esperado


def test_entradas_invalidas() -> None:
    with pytest.raises(ValueError, match="negativo"):
        reais_por_extenso(D("-1.00"))
    with pytest.raises(ValueError, match="2 casas"):
        reais_por_extenso(D("1.005"))
    with pytest.raises(ValueError, match="limite"):
        inteiro_por_extenso(10**15)
    with pytest.raises(ValueError, match="limite"):
        inteiro_por_extenso(-1)


def test_aceita_decimal_com_zeros_extras() -> None:
    assert reais_por_extenso(D("12.500")) == "doze reais e cinquenta centavos"
