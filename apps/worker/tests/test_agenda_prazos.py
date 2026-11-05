"""calcular_prazos com banco (VV_ADMIN_URL_TEST): eventos, histórico, override preservado, prazo do edital."""

import os
import uuid
from datetime import UTC, datetime
from typing import Any

import psycopg
import pytest

from tests.test_coleta import _admin, _n
from worker.agenda import calcular_acompanhamento

pytestmark = pytest.mark.skipif(
    not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste"
)
AGORA = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)


@pytest.fixture
def cena() -> Any:
    assert _admin("select current_database()")[0][0] != "vv"
    emp = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, 'Agenda Teste', '11222333000181')",
        emp,
    )
    fonte = _admin("select id from ops.fontes where slug = 'pncp'")[0][0]
    org = _admin(
        "insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values (%s, 'Órgão', 'PR', '4106902') returning id",
        f"{uuid.uuid4().int % 10**14:014d}",
    )[0][0]
    ed = _admin(
        "insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) values (%s, %s, %s, 'x', repeat('a', 64)) returning id",
        fonte,
        f"AG-{uuid.uuid4()}",
        org,
    )[0][0]
    ac = _admin(
        "insert into priv.acompanhamentos (empresa_id, edital_id, data_abertura, abertura_confirmada) values (%s, %s, %s, true) returning id",
        emp,
        ed,
        datetime(2026, 12, 16, 10, 0, tzinfo=UTC),
    )[0][0]
    conn = psycopg.connect(os.environ["VV_ADMIN_URL_TEST"])
    conn.execute("set role vv_worker")
    conn.commit()
    yield conn, emp, str(ac)
    conn.close()
    _admin("alter table priv.agenda_evento_historico disable trigger agenda_historico_imutavel")
    _admin("delete from priv.agenda_evento_historico")
    _admin("delete from priv.agenda_eventos")
    _admin("delete from priv.agenda_feriados")
    _admin("delete from priv.agenda_parametros")
    _admin("delete from priv.acompanhamentos")
    _admin("alter table priv.agenda_evento_historico enable trigger agenda_historico_imutavel")
    _admin("alter table core.empresas disable trigger user")
    _admin("delete from core.empresas where id = %s", emp)
    _admin("alter table core.empresas enable trigger user")


def _evento(ac: str, tipo: str) -> Any:
    return _admin(
        "select data_limite_legal at time zone 'America/Sao_Paulo', origem_prazo, provisorio, regra_validada, aviso_calculo from priv.agenda_eventos where acompanhamento_id = %s and tipo = %s",
        ac,
        tipo,
    )[0]


def test_abertura_confirmada_gera_disputa_esclarecimento_e_impugnacao(cena: Any) -> None:
    conn, _, ac = cena
    assert calcular_acompanhamento(conn, ac, AGORA) == 3
    assert _n(f"select count(*) from priv.agenda_eventos where acompanhamento_id = '{ac}'") == 3
    esc = _evento(ac, "esclarecimento")
    assert esc[0] == datetime(
        2026, 12, 11, 23, 59
    )  # abertura 16/12 07:00 BRT; 3 úteis antes = 11/12
    assert esc[1:4] == (
        "regra",
        False,
        False,
    )  # confirmada, mas a regra NÃO foi validada pelo jurídico
    assert "feriados municipais" in esc[4]
    assert _evento(ac, "disputa")[0] == datetime(2026, 12, 16, 7, 0)
    assert (
        _n(
            "select count(*) from priv.agenda_evento_historico where motivo = 'cálculo inicial' and empresa_id is not null"
        )
        == 3
    )


def test_recalculo_idempotente_e_registra_so_o_que_mudou(cena: Any) -> None:
    conn, _, ac = cena
    calcular_acompanhamento(conn, ac, AGORA)
    assert calcular_acompanhamento(conn, ac, AGORA) == 0
    _admin(
        "update priv.acompanhamentos set data_abertura = %s where id = %s",
        datetime(2026, 12, 21, 10, 0, tzinfo=UTC),
        ac,
    )
    assert calcular_acompanhamento(conn, ac, AGORA) == 3
    assert _evento(ac, "impugnacao")[0] == datetime(
        2026, 12, 16, 23, 59
    )  # 21/12 menos 3 úteis (18, 17, 16)
    h = _admin(
        "select antes, depois from priv.agenda_evento_historico where motivo = 'recálculo' order by em limit 1"
    )
    assert h and h[0][0] != h[0][1]


def test_override_manual_nao_e_sobrescrito_pelo_recalculo(cena: Any) -> None:
    conn, _, ac = cena
    calcular_acompanhamento(conn, ac, AGORA)
    _admin(
        "update priv.agenda_eventos set data_limite_legal = %s, origem_prazo = 'manual' where acompanhamento_id = %s and tipo = 'esclarecimento'",
        datetime(2026, 12, 9, 20, 0, tzinfo=UTC),
        ac,
    )
    _admin(
        "update priv.acompanhamentos set data_abertura = %s where id = %s",
        datetime(2026, 12, 21, 10, 0, tzinfo=UTC),
        ac,
    )
    calcular_acompanhamento(conn, ac, AGORA)
    esc = _evento(ac, "esclarecimento")
    assert esc[0] == datetime(2026, 12, 9, 17, 0) and esc[1] == "manual"
    assert "ajustado à mão" in esc[4]


def test_prazo_fixado_pelo_edital_prevalece(cena: Any) -> None:
    conn, _, ac = cena
    _admin(
        "update priv.acompanhamentos set prazo_impugnacao_edital = %s, clausula_prazos = 'item 12.1' where id = %s",
        datetime(2026, 12, 9, 20, 0, tzinfo=UTC),
        ac,
    )
    calcular_acompanhamento(conn, ac, AGORA)
    imp = _admin(
        "select origem_prazo, clausula_edital from priv.agenda_eventos where acompanhamento_id = %s and tipo = 'impugnacao'",
        ac,
    )[0]
    assert imp == ("edital", "item 12.1")


def test_abertura_sugerida_deixa_os_prazos_provisorios(cena: Any) -> None:
    conn, _, ac = cena
    _admin("update priv.acompanhamentos set abertura_confirmada = false where id = %s", ac)
    calcular_acompanhamento(conn, ac, AGORA)
    assert _evento(ac, "esclarecimento")[2] is True and _evento(ac, "disputa")[2] is True


def test_fato_gerador_cria_o_prazo_com_a_regra_certa(cena: Any) -> None:
    conn, emp, ac = cena
    _admin(
        "insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, base_data) values (%s, %s, 'regularizacao_fiscal_me_epp', %s)",
        emp,
        ac,
        datetime(2026, 4, 17, 15, 0, tzinfo=UTC),
    )
    calcular_acompanhamento(conn, ac, AGORA)
    assert _evento(ac, "regularizacao_fiscal_me_epp")[0] == datetime(
        2026, 4, 27, 23, 59
    )  # 21/04 é feriado


def test_feriado_proprio_da_empresa_desloca_o_prazo_e_some_o_aviso(cena: Any) -> None:
    conn, emp, ac = cena
    _admin(
        "insert into priv.agenda_feriados (empresa_id, data, nome, abrangencia, uf, codigo_ibge) values (%s, '2026-12-14', 'Feriado do município (teste)', 'municipio', 'PR', '4106902')",
        emp,
    )
    calcular_acompanhamento(conn, ac, AGORA)
    esc = _evento(ac, "esclarecimento")
    assert esc[0] == datetime(
        2026, 12, 10, 23, 59
    )  # 14/12 (segunda) deixou de contar como dia útil
    assert "feriados municipais" not in (esc[4] or "")


def test_feriado_de_outra_empresa_nao_vale(cena: Any) -> None:
    conn, _emp, ac = cena
    outra = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, 'Outra', '12ABC34501DE35')",
        outra,
    )
    try:
        _admin(
            "insert into priv.agenda_feriados (empresa_id, data, nome, abrangencia, uf, codigo_ibge) values (%s, '2026-12-14', 'Só da outra', 'municipio', 'PR', '4106902')",
            outra,
        )
        calcular_acompanhamento(conn, ac, AGORA)
        assert _evento(ac, "esclarecimento")[0] == datetime(2026, 12, 11, 23, 59)
    finally:
        _admin("alter table core.empresas disable trigger user")
        _admin("delete from priv.agenda_feriados where empresa_id = %s", outra)
        _admin("delete from core.empresas where id = %s", outra)
        _admin("alter table core.empresas enable trigger user")


def test_parametro_dias_internos_da_empresa(cena: Any) -> None:
    conn, emp, ac = cena
    calcular_acompanhamento(conn, ac, AGORA)
    padrao = _admin(
        "select data_interna_recomendada from priv.agenda_eventos where acompanhamento_id = %s and tipo = 'esclarecimento'",
        ac,
    )[0][0]
    _admin("insert into priv.agenda_parametros (empresa_id, dias_internos) values (%s, 4)", emp)
    calcular_acompanhamento(conn, ac, AGORA)
    novo = _admin(
        "select data_interna_recomendada from priv.agenda_eventos where acompanhamento_id = %s and tipo = 'esclarecimento'",
        ac,
    )[0][0]
    assert novo < padrao
    assert (padrao - novo).days >= 2  # 4 dias úteis antes em vez de 2
