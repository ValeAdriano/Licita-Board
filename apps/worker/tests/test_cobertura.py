"""Cobertura contra a amostra: número de controle por texto ou link; sem amostra nada se afirma."""

import os
from datetime import date
from typing import Any

import pytest

from tests.test_coleta import AGORA, _admin, _execucao, _n, conn  # noqa: F401
from tests.test_pncp import FakeHttp
from worker.pesquisa.cobertura import apurar, numero_de_controle
from worker.pesquisa.coleta import coletar


def test_numero_de_controle_do_texto_e_do_link() -> None:
    assert (
        numero_de_controle("ver 78200482000110-1-000298/2026 no PNCP")
        == "78200482000110-1-000298/2026"
    )
    assert (
        numero_de_controle("https://pncp.gov.br/app/editais/78200482000110/2026/298")
        == "78200482000110-1-000298/2026"
    )
    assert numero_de_controle("edital sem identificador") is None


@pytest.mark.skipif(not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste")
def test_apura_encontrados_e_lista_os_que_faltam_sem_inventar_causa(conn: Any) -> None:
    coletar(conn, _execucao(), FakeHttp(), AGORA)
    mes = date(2026, 11, 1)
    _admin("delete from ops.cobertura_resultados")
    _admin("delete from ops.amostra_cobertura")
    for ref, uf in [
        ("78200482000110-1-000298/2026", "PR"),
        ("https://pncp.gov.br/app/editais/80257355000108/2026/484", "PR"),
        ("11111111000191-1-000001/2026", "PR"),
        ("22222222000191-1-000001/2026", "SP"),
    ]:
        _admin(
            "insert into ops.amostra_cobertura (referencia, uf, mes_referencia) values (%s, %s, %s)",
            ref,
            uf,
            mes,
        )
    assert apurar(conn, mes) == {"total": 4, "encontrados": 2}
    r = {
        x[0]: (x[1], x[2])
        for x in _admin(
            "select a.referencia, r.encontrado, r.causa from ops.cobertura_resultados r join ops.amostra_cobertura a on a.id = r.amostra_id"
        )
    }
    assert r["11111111000191-1-000001/2026"] == (
        False,
        None,
    )  # causa fica para uma pessoa classificar
    assert r["22222222000191-1-000001/2026"] == (False, "fonte_nao_coberta")  # SP não é coberta
    _admin("delete from ops.cobertura_resultados")
    _admin("delete from ops.amostra_cobertura")
    assert _n("select count(*) from ops.amostra_cobertura") == 0


@pytest.mark.skipif(not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste")
def test_sem_amostra_nao_calcula_nada(conn: Any) -> None:
    _admin("delete from ops.cobertura_resultados")
    _admin("delete from ops.amostra_cobertura")
    assert apurar(conn, date(2026, 11, 1)) == {"total": 0, "encontrados": 0}
