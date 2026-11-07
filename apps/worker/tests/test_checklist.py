"""Job do checklist documental com banco (VV_ADMIN_URL_TEST): situação por exigência, ME/EPP, outra empresa, idempotência."""

import os
import uuid
from datetime import UTC, datetime
from typing import Any

import psycopg
import pytest

from tests.test_coleta import _admin, _n
from worker.checklist import calcular, enfileirar
from worker.rules.checklist_documental import AVISO_ME_EPP

pytestmark = pytest.mark.skipif(
    not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste"
)
AGORA = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)
ABERTURA = datetime(2026, 12, 16, 13, 0, tzinfo=UTC)  # 10:00 em Brasília


def _cnpj() -> str:
    """CNPJ fictício com dígitos verificadores válidos (o banco confere)."""
    base = [int(c) for c in f"{uuid.uuid4().int % 10**12:012d}"]
    for pesos in ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]):
        r = sum(d * p for d, p in zip(base, pesos, strict=True)) % 11
        base.append(0 if r < 2 else 11 - r)
    return "".join(map(str, base))


def _empresa(nome: str) -> str:
    emp = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, %s, %s)",
        emp,
        nome,
        _cnpj(),
    )
    return emp


@pytest.fixture
def cena() -> Any:
    assert _admin("select current_database()")[0][0] != "vv"
    emp, outra = _empresa("Checklist A"), _empresa("Checklist B")
    fonte = _admin("select id from ops.fontes where slug = 'pncp'")[0][0]
    org = _admin(
        "insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values (%s, 'Órgão', 'PR', '4106902') returning id",
        f"{uuid.uuid4().int % 10**14:014d}",
    )[0][0]
    ed = _admin(
        "insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) values (%s, %s, %s, 'x', repeat('a', 64)) returning id",
        fonte,
        f"CK-{uuid.uuid4()}",
        org,
    )[0][0]
    ac = _admin(
        "insert into priv.acompanhamentos (empresa_id, edital_id, data_abertura, abertura_confirmada) values (%s, %s, %s, true) returning id",
        emp,
        ed,
        ABERTURA,
    )[0][0]
    conn = psycopg.connect(os.environ["VV_ADMIN_URL_TEST"])
    conn.execute("set role vv_worker")
    conn.commit()
    yield conn, emp, outra, str(ac)
    conn.close()
    _admin("delete from ops.jobs where tipo = 'checklist_documental'")
    _admin("delete from priv.checklist_resultados where empresa_id in (%s, %s)", emp, outra)
    _admin("delete from priv.checklist_exigencias where empresa_id in (%s, %s)", emp, outra)
    _admin("delete from priv.acompanhamentos where empresa_id in (%s, %s)", emp, outra)
    _admin("delete from priv.documentos where empresa_id in (%s, %s)", emp, outra)
    _admin("alter table core.empresas disable trigger user")
    _admin("alter table core.empresa_enquadramentos disable trigger user")
    _admin("delete from core.empresa_enquadramentos where empresa_id in (%s, %s)", emp, outra)
    _admin("alter table core.empresa_enquadramentos enable trigger user")
    _admin("delete from core.empresas where id in (%s, %s)", emp, outra)
    _admin("alter table core.empresas enable trigger user")


def _tipo(slug: str) -> Any:
    return _admin("select id from pub.tipos_documento where slug = %s", slug)[0][0]


def _exigencia(emp: str, ac: str, slug: str, **kw: Any) -> str:
    return str(
        _admin(
            "insert into priv.checklist_exigencias (empresa_id, acompanhamento_id, tipo_id, aplicavel, conferencia_manual, regularidade_fiscal) "
            "values (%s, %s, %s, %s, %s, %s) returning id",
            emp,
            ac,
            _tipo(slug),
            kw.get("aplicavel", True),
            kw.get("conferencia_manual", False),
            kw.get("regularidade_fiscal", False),
        )[0][0]
    )


def _doc(emp: str, slug: str, validade: str | None, status: str = "liberado", **kw: Any) -> str:
    d = _admin(
        "insert into priv.documentos (empresa_id, tipo_id, descricao, sem_vencimento) values (%s, %s, 'Doc', %s) returning id",
        emp,
        _tipo(slug),
        kw.get("sem_vencimento", False),
    )[0][0]
    _admin(
        "insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, validade, status_arquivo) "
        "values (%s, %s, 1, %s, 'a.pdf', %s, %s)",
        d,
        emp,
        f"k/{uuid.uuid4()}",
        validade,
        status,
    )
    return str(d)


def _resultado(ex: str) -> Any:
    r = _admin(
        "select situacao, documento_id::text, validade::text, dias_para_vencer, aviso, data_sessao::text, sessao_confirmada, me_epp "
        "from priv.checklist_resultados where exigencia_id = %s",
        ex,
    )
    return r[0] if r else None


def test_situacao_por_exigencia(cena: Any) -> None:
    conn, emp, _, ac = cena
    cnd = _doc(emp, "cnd_federal", "2026-12-01")  # vence antes da sessão (16/12)
    _doc(emp, "crf_fgts", "2026-11-01")  # vencido
    cndt = _doc(emp, "cndt", "2027-03-01")  # válido
    _doc(emp, "cnd_estadual", "2027-03-01", status="quarentena")  # não liberado = ausente
    alvara = _doc(emp, "alvara", None, sem_vencimento=True)
    e = {
        "cnd": _exigencia(emp, ac, "cnd_federal"),
        "fgts": _exigencia(emp, ac, "crf_fgts"),
        "cndt": _exigencia(emp, ac, "cndt"),
        "estadual": _exigencia(emp, ac, "cnd_estadual"),
        "alvara": _exigencia(emp, ac, "alvara"),
        "balanco": _exigencia(emp, ac, "balanco", conferencia_manual=True),
        "municipal": _exigencia(emp, ac, "cnd_municipal", aplicavel=False),
    }
    assert calcular(conn, ac, AGORA, emp) == 7
    assert _resultado(e["cnd"])[:4] == ("vence_antes_da_sessao", cnd, "2026-12-01", 21)
    assert _resultado(e["fgts"])[0] == "vencido" and _resultado(e["fgts"])[3] == -9
    assert _resultado(e["cndt"])[:2] == ("valido", cndt)
    assert _resultado(e["estadual"])[:2] == ("ausente", None)
    assert _resultado(e["alvara"])[:4] == ("valido", alvara, None, None)
    assert _resultado(e["balanco"])[0] == "depende_conferencia"
    assert _resultado(e["municipal"])[:2] == ("nao_aplicavel", None)
    assert _resultado(e["cnd"])[5:] == ("2026-12-16", True, False)
    assert all(_resultado(x)[4] is None for x in e.values())  # sem ME/EPP, sem aviso


def test_aviso_me_epp_so_em_regularidade_fiscal_com_problema(cena: Any) -> None:
    conn, emp, _, ac = cena
    _admin(
        "insert into core.empresa_enquadramentos (empresa_id, porte, data_referencia, fonte) values (%s, 'EPP', '2026-01-01', 'declaracao')",
        emp,
    )
    _doc(emp, "cndt", "2027-03-01")
    fiscal_ausente = _exigencia(emp, ac, "cnd_federal", regularidade_fiscal=True)
    fiscal_ok = _exigencia(emp, ac, "cndt", regularidade_fiscal=True)
    outro_ausente = _exigencia(emp, ac, "contrato_social")
    calcular(conn, ac, AGORA, emp)
    assert _resultado(fiscal_ausente)[0] == "ausente"
    assert _resultado(fiscal_ausente)[4] == AVISO_ME_EPP  # sinaliza, não dispensa
    assert _resultado(fiscal_ausente)[7] is True
    assert _resultado(fiscal_ok)[4] is None
    assert _resultado(outro_ausente)[4] is None


def test_outra_empresa_e_removida_e_idempotencia(cena: Any) -> None:
    conn, emp, outra, ac = cena
    _doc(outra, "cnd_federal", "2027-03-01")  # documento de B não vale para A
    ex = _exigencia(emp, ac, "cnd_federal")
    assert calcular(conn, ac, AGORA, outra) is None  # job com empresa errada: nada é gravado
    assert _resultado(ex) is None
    assert calcular(conn, ac, AGORA, emp) == 1
    assert _resultado(ex)[0] == "ausente"
    assert calcular(conn, ac, AGORA, emp) == 1  # de novo: regrava, não duplica
    assert _n(f"select count(*) from priv.checklist_resultados where exigencia_id = '{ex}'") == 1
    _admin("update priv.checklist_exigencias set deleted_at = now() where id = %s", ex)
    assert calcular(conn, ac, AGORA, emp) == 0
    assert _resultado(ex) is None  # resultado da exigência removida sai


def test_rodada_diaria_um_job_por_dia(cena: Any) -> None:
    conn, emp, _, ac = cena
    _exigencia(emp, ac, "cnd_federal")
    _admin("delete from ops.jobs where tipo = 'checklist_documental'")
    hoje = AGORA.date()
    assert enfileirar(conn, hoje) >= 1
    enfileirar(conn, hoje)
    assert (
        _n(
            f"select count(*) from ops.jobs where tipo = 'checklist_documental' and payload->>'acompanhamento_id' = '{ac}'"
        )
        == 1
    )
