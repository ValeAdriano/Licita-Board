from worker.rules.evidencia import contem, normalizar, pagina_da_citacao

FONTE = "O veículo deverá possuir potência mínima de 110 cv (80,9 kW), motor flex\ne câmbio automá-\ntico de 6 marchas."


def test_acha_citacao_ignorando_acento_caixa_quebra_e_hifenizacao() -> None:
    assert contem("POTENCIA MINIMA DE 110 CV", FONTE)
    assert contem("motor flex e câmbio automático", FONTE)
    assert contem("câmbio automático de 6 marchas", FONTE)


def test_nao_acha_citacao_inventada_ou_alterada() -> None:
    assert not contem("potência mínima de 120 cv", FONTE)
    assert not contem("tração 4x4 permanente", FONTE)


def test_citacao_curta_demais_nao_prova_nada() -> None:
    assert not contem("motor", FONTE)
    assert not contem("   ", FONTE)


def test_pagina_da_citacao() -> None:
    paginas = {3: "Cláusula sobre garantia de 36 meses para o veículo.", 1: FONTE}
    assert pagina_da_citacao("garantia de 36 meses", paginas) == 3
    assert pagina_da_citacao("potência mínima de 110 cv", paginas) == 1
    assert pagina_da_citacao("airbag duplo frontal", paginas) is None


def test_normalizar() -> None:
    assert normalizar("  Ação\n  Rápida ") == "acao rapida"
