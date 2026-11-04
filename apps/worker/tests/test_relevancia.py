from decimal import Decimal

from worker.rules.relevancia import (
    Filtros,
    ItemEntrada,
    Termo,
    TrechoRef,
    avaliar,
    faixa_da_nota,
    normalizar,
)


def item(
    desc: str = "Cadeira escolar com prancheta", obj: str = "Aquisição de mobiliário", **kw: object
) -> ItemEntrada:
    return ItemEntrada(
        descricao=desc,
        objeto=obj,
        uf=kw.get("uf", "PR"),
        municipio=kw.get("municipio", "Curitiba"),
        valor=kw.get("valor"),
        trechos=kw.get("trechos", ()),
    )  # type: ignore[arg-type]


def test_normalizar_tira_acento_caixa_e_espaco() -> None:
    assert normalizar("  Aquisição   de  CADEIRAS ") == "aquisicao de cadeiras"


def test_termo_no_item_pontua_mais_que_no_objeto_e_no_trecho() -> None:
    t = [Termo("palavra", "cadeira")]
    no_item = avaliar(item(), t, Filtros())
    no_objeto = avaliar(item(desc="Mobiliário escolar", obj="Compra de cadeira"), t, Filtros())
    no_trecho = avaliar(
        item(
            desc="Mobiliário",
            obj="Compra",
            trechos=(TrechoRef("a1", 7, "Deve ser cadeira ergonômica."),),
        ),
        t,
        Filtros(),
    )
    assert no_item.nota > no_objeto.nota > no_trecho.nota > 0
    assert no_trecho.motivos[0] == {
        "tipo": "palavra",
        "termo": "cadeira",
        "onde": "trecho",
        "arquivo_id": "a1",
        "pagina": 7,
    }


def test_palavra_inteira_cadeira_nao_casa_com_cadeirante() -> None:
    assert (
        avaliar(item(desc="Rampa para cadeirante"), [Termo("palavra", "cadeira")], Filtros()).nota
        == 0
    )


def test_sem_acento_casa_com_acento() -> None:
    assert avaliar(item(desc="Ônibus escolar"), [Termo("palavra", "onibus")], Filtros()).nota > 0


def test_nota_soma_termos_distintos_e_limita_em_100() -> None:
    termos = [
        Termo("palavra", "cadeira"),
        Termo("sinonimo", "prancheta"),
        Termo("marca", "escolar"),
        Termo("modelo", "cadeira escolar"),
    ]
    a = avaliar(item(), termos, Filtros())
    assert a.nota == 100


def test_mesmo_termo_repetido_nao_pontua_duas_vezes() -> None:
    um = avaliar(item(), [Termo("palavra", "cadeira")], Filtros())
    dois = avaliar(item(), [Termo("palavra", "cadeira"), Termo("palavra", "CADEIRA")], Filtros())
    assert um.nota == dois.nota == 30


def test_exclusao_reduz_e_fica_registrada() -> None:
    termos = [
        Termo("palavra", "cadeira"),
        Termo("sinonimo", "escolar"),
        Termo("exclusao", "prancheta"),
    ]
    a = avaliar(item(), termos, Filtros())
    assert a.nota == 15  # 30 + 25 - 40
    assert {"tipo": "exclusao", "termo": "prancheta", "onde": "item"} in a.motivos


def test_nota_nunca_fica_negativa() -> None:
    assert avaliar(item(), [Termo("exclusao", "cadeira")], Filtros()).nota == 0


def test_baixa_relevancia_continua_avaliada_nunca_descartada() -> None:
    a = avaliar(item(desc="Pneu de trator"), [Termo("palavra", "cadeira")], Filtros())
    assert (a.nota, a.faixa) == (0, "baixa")


def test_filtro_nao_atendido_rebaixa_uma_faixa_e_registra() -> None:
    termos = [Termo("palavra", "cadeira"), Termo("sinonimo", "escolar")]  # 55 = média
    ok = avaliar(item(), termos, Filtros(ufs=("PR",)))
    fora = avaliar(item(), termos, Filtros(ufs=("SC",)))
    assert ok.faixa == "media" and not ok.fora_dos_filtros
    assert fora.nota == ok.nota and fora.faixa == "baixa"
    assert fora.fora_dos_filtros == [{"filtro": "uf", "valor": "PR"}]


def test_filtro_de_valor_usa_decimal() -> None:
    f = Filtros(valor_min=Decimal("1000.00"), valor_max=Decimal("5000.00"))
    assert (
        avaliar(item(valor=Decimal("999.9999")), [], f).fora_dos_filtros[0]["filtro"] == "valor_min"
    )
    assert (
        avaliar(item(valor=Decimal("5000.0001")), [], f).fora_dos_filtros[0]["filtro"]
        == "valor_max"
    )
    assert avaliar(item(valor=Decimal("1000.00")), [], f).fora_dos_filtros == []
    assert avaliar(item(valor=None), [], f).fora_dos_filtros == []  # sem valor informado não filtra


def test_filtro_de_municipio_e_restricao() -> None:
    f = Filtros(municipios=(("PR", "Curitiba"),), restricoes=("obra",))
    assert avaliar(item(), [], f).fora_dos_filtros == []
    assert avaliar(item(municipio="Londrina"), [], f).fora_dos_filtros[0]["filtro"] == "municipio"
    assert (
        avaliar(item(desc="Reforma e obra civil"), [], f).fora_dos_filtros[0]["filtro"]
        == "restricao"
    )


def test_semelhanca_semantica_so_ajuda_acima_de_meio() -> None:
    base = avaliar(item(desc="Mobiliário"), [], Filtros())
    assert avaliar(item(desc="Mobiliário"), [], Filtros(), Decimal("0.4")).nota == base.nota == 0
    assert (
        avaliar(item(desc="Mobiliário"), [], Filtros(), Decimal("0.8")).nota == 30
    )  # teto do bônus


def test_faixas() -> None:
    assert [faixa_da_nota(n) for n in (0, 29, 30, 59, 60, 100)] == [
        "baixa",
        "baixa",
        "media",
        "media",
        "alta",
        "alta",
    ]
