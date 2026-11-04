"""Job de relevância com banco: empresas só veem o que os SEUS termos acham; triagem sobrevive à reavaliação."""

import os
import uuid
from typing import Any

import pytest

from tests.test_coleta import AGORA, _admin, _execucao, _n, conn  # noqa: F401
from tests.test_pncp import FakeHttp
from worker.pesquisa.coleta import coletar
from worker.pesquisa.relevancia import avaliar_edital

pytestmark = pytest.mark.skipif(
    not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste"
)


def _empresa(
    cnpj: str, termos: list[tuple[str, str]], filtros: list[tuple[str, str | None]] | None = None
) -> str:
    eid = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, %s, %s)",
        eid,
        f"Teste {cnpj}",
        cnpj,
    )
    for tipo, termo in termos:
        _admin(
            "insert into priv.palavras_chave (empresa_id, tipo, termo, termo_normalizado) values (%s, %s, %s, lower(%s))",
            eid,
            tipo,
            termo,
            termo,
        )
    for tipo, uf in filtros or []:
        _admin(
            "insert into priv.palavras_chave_filtros (empresa_id, tipo, uf) values (%s, %s, %s)",
            eid,
            tipo,
            uf,
        )
    return eid


@pytest.fixture
def empresas() -> Any:
    a = _empresa("11222333000181", [("palavra", "eletrodo"), ("sinonimo", "ecg")])
    b = _empresa("11444777000161", [("palavra", "trator")], [("uf", "SC")])
    sem = _empresa("11111111000191", [])
    yield a, b, sem
    _admin("alter table priv.oportunidades disable trigger user")
    _admin("delete from priv.oportunidades")
    _admin("delete from priv.palavras_chave_filtros")
    _admin("delete from priv.palavras_chave")
    _admin("alter table core.empresas disable trigger user")
    _admin(
        "delete from core.empresas where cnpj in ('11222333000181', '11444777000161', '11111111000191')"
    )
    _admin("alter table core.empresas enable trigger user")
    _admin("alter table priv.oportunidades enable trigger user")


def _edital_484() -> str:
    return str(_admin("select id from pub.editais where id_externo like '80257355000108%'")[0][0])


def test_cada_empresa_so_recebe_o_que_os_seus_termos_acham(conn: Any, empresas: Any) -> None:
    a, b, sem = empresas
    coletar(conn, _execucao(), FakeHttp(), AGORA)
    assert avaliar_edital(conn, _edital_484()) == 16  # 8 itens x 2 empresas com termos
    assert (
        _n(f"select count(*) from priv.oportunidades where empresa_id = '{a}' and faixa <> 'baixa'")
        == 6
    )  # eletrodos
    assert (
        _n(f"select count(*) from priv.oportunidades where empresa_id = '{a}' and nota = 0") == 2
    )  # curativos: baixa relevância, não somem
    assert _n(f"select count(*) from priv.oportunidades where empresa_id = '{b}' and nota = 0") == 8
    assert _n(f"select count(*) from priv.oportunidades where empresa_id = '{sem}'") == 0
    # filtro de UF da empresa B (SC) não casa com PR: continua listada, só rebaixada e com o motivo registrado.
    assert (
        _n(
            f"select count(*) from priv.oportunidades where empresa_id = '{b}' and fora_dos_filtros <> '[]'"
        )
        == 8
    )
    m = _admin(
        f"select motivos from priv.oportunidades where empresa_id = '{a}' and nota > 0 limit 1"
    )[0][0]
    assert m[0]["termo"] in ("eletrodo", "ecg") and m[0]["onde"] == "item"


def test_reavaliar_preserva_a_triagem_e_nao_duplica(conn: Any, empresas: Any) -> None:
    a, _, _ = empresas
    coletar(conn, _execucao(), FakeHttp(), AGORA)
    avaliar_edital(conn, _edital_484())
    _admin(
        f"update priv.oportunidades set triagem = 'interesse', triagem_em = now() where id = (select id from priv.oportunidades where empresa_id = '{a}' limit 1)"
    )
    n = _n("select count(*) from priv.oportunidades")
    avaliar_edital(conn, _edital_484())
    assert _n("select count(*) from priv.oportunidades") == n
    assert (
        _n(
            f"select count(*) from priv.oportunidades where empresa_id = '{a}' and triagem = 'interesse'"
        )
        == 1
    )


def test_item_retirado_na_retificacao_fica_marcado_e_nao_e_apagado(
    conn: Any, empresas: Any
) -> None:
    from tests.test_coleta import HttpRetificado  # noqa: PLC0415

    coletar(conn, _execucao(), FakeHttp(), AGORA)
    avaliar_edital(conn, _edital_484())
    coletar(conn, _execucao(), HttpRetificado(), AGORA)  # um item a menos
    avaliar_edital(conn, _edital_484())
    assert (
        _n("select count(*) from priv.oportunidades where retirado") == 1 * 2
    )  # o item sumido, para A e B
    assert _n("select count(*) from priv.oportunidades") == 16
