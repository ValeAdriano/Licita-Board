from decimal import Decimal as D

import pytest

from worker.rules.comparacao import (
    CandidatoAlternativa,
    Requisito,
    Resultado,
    Unidade,
    Valor,
    classificar,
    comparar,
    para_base,
    ranquear_alternativas,
    resumo,
)

W = Unidade("W", "potencia", D(1))
KW = Unidade("kW", "potencia", D(1000))
CV = Unidade("cv", "potencia", D("735.49875"))
MB = Unidade("MB", "dados", D(1_000_000))
GB = Unidade("GB", "dados", D(1_000_000_000))
KGFM = Unidade("kgf·m", "torque", D("9.80665"))
NM = Unidade("N·m", "torque", D(1))
MM = Unidade("mm", "comprimento", D("0.001"))
CELSIUS = Unidade("°C", "temperatura", D(1), D("273.15"))
KELVIN = Unidade("K", "temperatura", D(1))


def num(n: str, u: Unidade | None = None) -> Valor:
    return Valor(numero=D(n), unidade=u)


def test_conversao_para_base() -> None:
    assert para_base(D("1.5"), KW) == D(1500)
    assert para_base(D(100), CV) == D("73549.875")
    assert para_base(D(0), CELSIUS) == D("273.15")


@pytest.mark.parametrize(
    ("operador", "exigido", "oferecido", "esperado"),
    [
        (">=", num("100", CV), num("75", KW), True),  # 75 kW = 75000 W > 73549,875 W (100 cv)
        (">=", num("100", CV), num("73", KW), False),
        (">=", num("8", GB), num("8192", MB), True),  # 8192 MB (decimal) = 8,192 GB
        (">=", num("8", GB), num("8000", MB), True),  # exatamente igual: atende o mínimo
        (">=", num("8", GB), num("7999", MB), False),
        ("<=", num("2000", MM), num("1.9", Unidade("m", "comprimento", D(1))), True),
        (
            "=",
            num("100", NM),
            num("10.1971621", KGFM),
            False,
        ),  # 10,197 kgf·m ≈ 100,0000 N·m? 10.1971621*9.80665 = 100.0000...
        (">=", num("350", NM), num("36", KGFM), True),  # 36 kgf·m = 353,04 N·m
        (">=", num("12"), num("12"), True),  # sem unidade dos dois lados (contagem)
        (">=", num("12"), num("11"), False),
        (">=", num("0", CELSIUS), num("273.15", KELVIN), True),  # deslocamento de temperatura
    ],
)
def test_comparacao_numerica_com_unidades(
    operador: str, exigido: Valor, oferecido: Valor, esperado: bool
) -> None:
    cumpre, motivo = comparar(Requisito(operador, exigido), oferecido)
    assert cumpre is esperado
    assert motivo is None


def test_faixa() -> None:
    req = Requisito("entre", num("90", KW), num("110", KW))
    assert comparar(req, num("100", KW))[0] is True
    assert comparar(req, num("110", KW))[0] is True
    assert comparar(req, num("111", KW))[0] is False
    assert comparar(Requisito("entre", num("90", KW), None), num("100", KW))[0] is None


@pytest.mark.parametrize(
    ("exigido", "oferecido"),
    [
        (num("100", CV), num("100", GB)),  # grandeza diferente
        (num("100", CV), num("100")),  # oferta sem unidade
        (num("100"), num("100", KW)),  # edital sem unidade
    ],
)
def test_unidade_incompativel_nao_compara(exigido: Valor, oferecido: Valor) -> None:
    cumpre, motivo = comparar(Requisito(">=", exigido), oferecido)
    assert cumpre is None and motivo is not None


def test_sem_oferta_ou_sem_numero_e_indeterminado() -> None:
    assert comparar(Requisito(">=", num("1", W)), None)[0] is None
    assert comparar(Requisito(">=", num("1", W)), Valor(texto="x"))[0] is None
    assert comparar(Requisito(">=", Valor(texto="x")), num("1", W))[0] is None
    assert comparar(Requisito("??", num("1")), num("1"))[0] is None


def test_texto_e_booleano() -> None:
    assert (
        comparar(
            Requisito("contem", Valor(texto="Automático")),
            Valor(texto="automatico de 6 marchas"),
        )[0]
        is True
    )
    assert (
        comparar(Requisito("contem", Valor(texto="manual")), Valor(texto="automatico"))[0] is False
    )
    assert comparar(Requisito("contem", Valor(texto="manual")), Valor())[0] is None
    assert comparar(Requisito("sim"), Valor(booleano=True))[0] is True
    assert comparar(Requisito("sim"), Valor(booleano=False))[0] is False
    assert comparar(Requisito("nao"), Valor(booleano=False))[0] is True
    assert comparar(Requisito("sim"), Valor())[0] is None


def test_decimal_sem_erro_de_ponto_flutuante() -> None:
    assert comparar(Requisito(">=", num("0.3")), num("0.1") if False else num("0.3"))[0] is True
    soma = D("0.1") + D("0.2")
    assert comparar(Requisito("=", num("0.3")), Valor(numero=soma))[0] is True


R = Requisito(">=", num("100", KW))
BOM = num("120", KW)


def test_atende_exige_citacao_verificada_e_ficha_conferida() -> None:
    assert (
        classificar(R, BOM, citacao_edital_ok=True, ficha_conferida=True).resultado
        is Resultado.ATENDE
    )
    c1 = classificar(R, BOM, citacao_edital_ok=False, ficha_conferida=True)
    c2 = classificar(R, BOM, citacao_edital_ok=True, ficha_conferida=False)
    assert c1.resultado is Resultado.A_CONFIRMAR and "citação" in (c1.pendencia or "")
    assert c2.resultado is Resultado.A_CONFIRMAR and "ficha técnica" in (c2.pendencia or "")


def test_ressalva_registrada_vira_atende_com_ressalvas() -> None:
    c = classificar(
        R, BOM, citacao_edital_ok=True, ficha_conferida=True, ressalva="entrega em 45 dias"
    )
    assert c.resultado is Resultado.RESSALVAS and "entrega em 45 dias" in (c.pendencia or "")


def test_nao_atende_independe_de_evidencia_e_falta_de_dado_e_a_confirmar() -> None:
    assert (
        classificar(R, num("80", KW), citacao_edital_ok=False, ficha_conferida=False).resultado
        is Resultado.NAO_ATENDE
    )
    c = classificar(R, None, citacao_edital_ok=True, ficha_conferida=True)
    assert c.resultado is Resultado.A_CONFIRMAR and c.pendencia


def test_nunca_atende_sem_evidencia_para_qualquer_combinacao() -> None:
    for citacao in (True, False):
        for ficha in (True, False):
            r = classificar(R, BOM, citacao_edital_ok=citacao, ficha_conferida=ficha).resultado
            assert (r is Resultado.ATENDE) == (citacao and ficha)


def test_resumo_do_item() -> None:
    a, rs, ac, na = (
        Resultado.ATENDE,
        Resultado.RESSALVAS,
        Resultado.A_CONFIRMAR,
        Resultado.NAO_ATENDE,
    )
    assert resumo([(True, a), (True, a)]) == "COMPATÍVEL"
    assert resumo([(True, a), (True, rs)]) == "COMPATÍVEL COM RESSALVAS"
    assert resumo([(True, a), (True, ac)]) == "PENDENTE"
    assert (
        resumo([(True, na), (True, ac), (True, a)]) == "REPROVADO"
    )  # obrigatório não atendido pesa mais que pendência
    assert resumo([(True, a), (False, na)]) == "COMPATÍVEL"  # opcional não reprova
    assert resumo([]) == "PENDENTE"
    assert resumo([(False, a)]) == "PENDENTE"  # só opcionais: sem requisito obrigatório cadastrado


def test_ficha_citacao_automatica_rebaixa_se_nao_constar_no_arquivo() -> None:
    ok = classificar(R, BOM, citacao_edital_ok=True, ficha_conferida=True, ficha_citacao_ok=True)
    assert ok.resultado is Resultado.ATENDE and "verificadas automaticamente" in ok.justificativa
    falha = classificar(
        R, BOM, citacao_edital_ok=True, ficha_conferida=True, ficha_citacao_ok=False
    )
    assert falha.resultado is Resultado.A_CONFIRMAR
    assert "não foi encontrada no texto extraído da ficha" in (falha.pendencia or "")


def test_ranquear_alternativas_por_compatibilidade_disponibilidade_e_custo_decimal() -> None:
    candidatos = [
        CandidatoAlternativa(
            analise_id="reprovado-barato",
            resumo="REPROVADO",
            riscos_count=0,
            pendencias_count=0,
            atende_count=5,
            disponibilidade="imediata",
            preco_custo=D("50000.00"),
        ),
        CandidatoAlternativa(
            analise_id="compativel-caro",
            resumo="COMPATÍVEL",
            riscos_count=0,
            pendencias_count=0,
            atende_count=5,
            disponibilidade="imediata",
            preco_custo=D("120000.50"),
        ),
        CandidatoAlternativa(
            analise_id="compativel-barato",
            resumo="COMPATÍVEL",
            riscos_count=0,
            pendencias_count=0,
            atende_count=5,
            disponibilidade="imediata",
            preco_custo=D("95000.25"),
        ),
        CandidatoAlternativa(
            analise_id="ressalvas",
            resumo="COMPATÍVEL COM RESSALVAS",
            riscos_count=1,
            pendencias_count=0,
            atende_count=4,
            disponibilidade="sob_encomenda",
            preco_referencia=D("90000.00"),
        ),
        CandidatoAlternativa(
            analise_id="pendente",
            resumo="PENDENTE",
            riscos_count=0,
            pendencias_count=2,
            atende_count=3,
        ),
    ]
    ranking = ranquear_alternativas(candidatos)
    assert [(r.analise_id, r.posicao, r.rotulo) for r in ranking] == [
        ("compativel-barato", 1, "melhor_compativel"),
        ("compativel-caro", 2, "segunda_alternativa"),
        ("ressalvas", 3, "terceira_alternativa"),
        ("pendente", 4, "outra"),
        ("reprovado-barato", 5, "reprovado"),
    ]
