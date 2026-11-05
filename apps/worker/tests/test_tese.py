"""Conferência das teses (job validar_tese): citação fora da base bloqueia; empresa do job; minuta usa só teses aprovadas do tipo."""

import os
import uuid
from typing import Any

import pytest

from tests.test_coleta import _admin
from tests.test_minuta_ia import IAFalsa, pedido  # noqa: F401
from tests.test_peca import HOJE, cena  # noqa: F401
from worker.minuta_ia import minutar
from worker.rules.citacoes import Entrada
from worker.tese import conferir, divergencias

BASE = [Entrada("lei", "14.133/2021", None, "art. 165")]


def test_divergencias_bloqueiam_so_citacao_fora_da_base() -> None:
    ok = divergencias(
        "A marca única restringe a competitividade (Lei 14.133/2021, art. 165).", BASE
    )
    assert [d for d in ok if d["bloqueia"]] == []
    ruim = divergencias("Conforme o Acórdão 999/2022 e a Lei 8.666/1993.", BASE)
    assert [d["codigo"] for d in ruim if d["bloqueia"]] == ["citacao_fora_da_base"] * 2
    sem = divergencias("Argumento puramente fático sobre o prazo de entrega.", BASE)
    assert [(d["codigo"], d["bloqueia"]) for d in sem] == [("sem_fundamento_citado", False)]
    assert "base_vazia" in {
        d["codigo"] for d in divergencias("texto qualquer sem citação nenhuma", [])
    }


pytestmark_db = pytest.mark.skipif(
    not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste"
)


@pytest.fixture
def tese(cena: Any) -> Any:
    tid = _admin(
        "insert into priv.teses (empresa_id, tipo_peca, titulo, texto, status, aprovada_por, aprovada_em) values (%s, 'impugnacao', 'Marca única', %s, 'aprovada', %s, now()) returning id",
        cena["emp"], "A exigência de marca específica restringe a competitividade (Lei 14.133/2021, art. 165).", cena["usuario"],
    )[0][0]  # fmt: skip
    _admin("insert into priv.teses (empresa_id, tipo_peca, titulo, texto) values (%s, 'impugnacao', 'Rascunho não aprovado', %s)", cena["emp"], "Texto de rascunho que não pode ir ao provedor.")  # fmt: skip
    ed = _admin(
        "select a.edital_id from priv.acompanhamentos a join priv.pecas p on p.acompanhamento_id = a.id where p.id = %s",
        cena["peca"],
    )[0][0]
    arq = _admin(
        "insert into pub.edital_arquivos (edital_id, url_origem, titulo) values (%s, 'https://exemplo.test/e.pdf', 'E') returning id",
        ed,
    )[0][0]
    _admin(
        "insert into pub.trechos (edital_id, arquivo_id, pagina, texto) values (%s, %s, 1, 'Cláusula 7.2: marca XPTO exigida.')",
        ed,
        arq,
    )
    yield {**cena, "tid": str(tid)}
    _admin("delete from pub.trechos where edital_id = %s", ed)
    _admin("delete from pub.edital_arquivos where edital_id = %s", ed)
    _admin("delete from priv.peca_teses")
    _admin("delete from priv.teses")


@pytestmark_db
def test_conferir_grava_validacao_e_respeita_a_empresa_do_job(tese: Any) -> None:
    assert conferir(tese["conn"], tese["tid"], str(uuid.uuid4())) is None
    assert conferir(tese["conn"], tese["tid"], tese["emp"]) is False
    assert _admin(
        "select bloqueada, validada_em is not null from priv.teses where id = %s", tese["tid"]
    )[0] == (False, True)
    _admin(
        "update priv.teses set texto = %s where id = %s",
        "Conforme o Acórdão 999/2022 do TCU, a marca única é ilegal.",
        tese["tid"],
    )
    assert conferir(tese["conn"], tese["tid"], tese["emp"]) is True
    assert _admin("select bloqueada from priv.teses where id = %s", tese["tid"])[0][0] is True


@pytestmark_db
def test_minuta_usa_so_teses_aprovadas_do_tipo(tese: Any) -> None:
    _admin(
        "update priv.pecas set status = 'triagem', minuta = null, clausulas = null where id = %s",
        tese["peca"],
    )
    mid = _admin(
        "insert into priv.pecas_ia (empresa_id, peca_id) values (%s, %s) returning id",
        tese["emp"],
        tese["peca"],
    )[0][0]
    ia = IAFalsa()
    assert minutar(tese["conn"], str(mid), ia, HOJE, tese["emp"]) == "concluida"
    usuario = ia.pedidos[0][1]
    assert (
        "<teses>" in usuario and "Marca única" in usuario and "Rascunho não aprovado" not in usuario
    )
