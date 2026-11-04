"""Importação manual pelo link do PNCP (Fase 04): mesmo resultado da coleta, sem duplicar."""

import os
import uuid
from typing import Any

import pytest

from tests.test_coleta import AGORA, _admin, _execucao, _n, conn  # noqa: F401
from tests.test_pncp import FakeHttp
from worker.pesquisa.coleta import coletar
from worker.pesquisa.importacao import importar

pytestmark = pytest.mark.skipif(
    not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste"
)
LINK = "https://pncp.gov.br/app/editais/78200482000110/2026/298"


@pytest.fixture
def empresa() -> Any:
    eid = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, 'Teste Importação', '11222333000181')",
        eid,
    )
    yield eid
    _admin("delete from priv.importacoes")
    _admin("alter table core.empresas disable trigger user")
    _admin("delete from core.empresas where id = %s", eid)
    _admin("alter table core.empresas enable trigger user")


def _pedir(empresa: str, url: str) -> str:
    r = _admin(
        "insert into priv.importacoes (empresa_id, tipo, url) values (%s, 'url', %s) returning id",
        empresa,
        url,
    )
    return str(r[0][0])


def test_importa_edital_novo_como_manual_e_nao_duplica_com_a_coleta(
    conn: Any, empresa: str
) -> None:
    assert importar(conn, _pedir(empresa, LINK), FakeHttp()) == "novo"
    assert _admin("select origem, versao_atual from pub.editais")[0] == ("manual", 1)
    assert _n("select count(*) from pub.edital_itens") == 1
    assert _n("select count(*) from ops.jobs where tipo = 'baixar_arquivo_edital'") >= 1
    assert _admin("select status from priv.importacoes")[0][0] == "ok"
    # De novo, e depois a coleta automática do mesmo edital: mesma chave oficial, nada duplica.
    assert importar(conn, _pedir(empresa, LINK), FakeHttp()) == "igual"
    coletar(conn, _execucao(), FakeHttp(), AGORA)
    assert _n("select count(*) from pub.editais") == 2  # o importado + o outro da fixture
    assert (
        _n(
            "select count(*) from pub.edital_versoes where edital_id = (select id from pub.editais where origem = 'manual')"
        )
        == 1
    )


def test_endereco_desconhecido_ou_edital_inexistente_falha_com_motivo(
    conn: Any, empresa: str
) -> None:
    i = _pedir(empresa, "https://pncp.gov.br/outra-coisa")
    assert importar(conn, i, FakeHttp()) == "falhou"
    assert "não reconhecido" in _admin("select erro from priv.importacoes where id = %s", i)[0][0]
    j = _pedir(empresa, "https://pncp.gov.br/app/editais/11222333000181/2026/1")
    assert importar(conn, j, FakeHttp()) == "falhou"
    assert "não encontrado" in _admin("select erro from priv.importacoes where id = %s", j)[0][0]
    assert _n("select count(*) from pub.editais") == 0
