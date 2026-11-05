"""Alertas da agenda e prazo perdido com banco (VV_ADMIN_URL_TEST): marcos, escalonamento, idempotência, destinatários."""

import os
import uuid
from datetime import UTC, datetime
from typing import Any

import psycopg
import pytest

from tests.test_coleta import _admin, _n
from worker.agenda_alertas import processar

pytestmark = pytest.mark.skipif(
    not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste"
)
AGORA = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)  # 09:00 em Brasília


def _brt(dia: int, hora: str = "23:59") -> str:
    return f"2026-11-{dia:02d} {hora}-03"


@pytest.fixture
def cena() -> Any:
    assert _admin("select current_database()")[0][0] != "vv"
    emp = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, 'Alertas Teste', '11222333000181')",
        emp,
    )
    usuarios: dict[str, str] = {}
    for chave, papel, perms in [
        ("gestor", "ADMIN_EMPRESA", ["visualizar"]),
        ("operador", "OPERADOR", ["visualizar"]),
        ("cliente", "CLIENTE", ["visualizar"]),
        ("sem_acesso", "OPERADOR", []),
    ]:
        uid = _admin(
            "insert into core.usuarios (email, nome, email_verificado_em) values (%s, %s, now()) returning id",
            f"{chave}-{uuid.uuid4().hex[:8]}@exemplo.test",
            chave,
        )[0][0]
        vid = _admin(
            "insert into core.vinculos (usuario_id, empresa_id, papel) values (%s, %s, %s) returning id",
            uid,
            emp,
            papel,
        )[0][0]
        for acao in perms:
            _admin(
                "insert into core.permissoes (vinculo_id, empresa_id, modulo, acao) values (%s, %s, 'agenda', %s)",
                vid,
                emp,
                acao,
            )
        usuarios[chave] = str(uid)
    fonte = _admin("select id from ops.fontes where slug = 'pncp'")[0][0]
    org = _admin(
        "insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values (%s, 'Órgão', 'PR', '4106902') returning id",
        f"{uuid.uuid4().int % 10**14:014d}",
    )[0][0]
    ed = _admin(
        "insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) values (%s, %s, %s, 'x', repeat('a', 64)) returning id",
        fonte,
        f"AL-{uuid.uuid4()}",
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
    yield conn, emp, str(ac), usuarios
    conn.close()
    _admin("alter table priv.agenda_evento_historico disable trigger agenda_historico_imutavel")
    _admin("delete from priv.agenda_evento_historico")
    _admin("delete from priv.agenda_alertas")
    _admin("delete from priv.agenda_eventos")
    _admin("delete from priv.acompanhamentos")
    _admin("alter table priv.agenda_evento_historico enable trigger agenda_historico_imutavel")
    _admin("alter table core.notificacoes disable trigger user")
    _admin("delete from core.notificacoes where empresa_id = %s", emp)
    _admin("alter table core.notificacoes enable trigger user")
    _admin("delete from ops.jobs where tipo = 'email_agenda'")
    _admin("alter table core.empresas disable trigger user")
    _admin("delete from core.permissoes where empresa_id = %s", emp)
    _admin("delete from core.vinculos where empresa_id = %s", emp)
    _admin("delete from core.empresas where id = %s", emp)
    _admin("alter table core.empresas enable trigger user")
    for u in usuarios.values():
        _admin("delete from core.usuarios where id = %s", u)


def _evento(
    emp: str, ac: str, tipo: str, limite: str, status: str = "sugerido", provisorio: bool = False
) -> str:
    return str(
        _admin(
            "insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, data_limite_legal, status, provisorio) "
            "values (%s, %s, %s, %s, %s, %s) returning id",
            emp,
            ac,
            tipo,
            limite,
            status,
            provisorio,
        )[0][0]
    )


def _status(ev: str) -> str:
    return str(_admin("select status from priv.agenda_eventos where id = %s", ev)[0][0])


def _alertas(ev: str, marco: str) -> int:
    return _n(
        f"select count(*) from priv.agenda_alertas where evento_id = '{ev}' and marco = '{marco}'"
    )


def test_prazo_vencido_vira_perdido_com_historico_e_avisa(cena: Any) -> None:
    conn, emp, ac, u = cena
    ev = _evento(emp, ac, "esclarecimento", _brt(9))
    r = processar(conn, AGORA)
    assert r.perdidos == 1
    assert _status(ev) == "prazo_perdido"
    assert (
        _n(
            f"select count(*) from priv.agenda_evento_historico where evento_id = '{ev}' and depois = 'prazo_perdido'"
        )
        == 1
    )
    # só o gestor tem agenda/visualizar com papel de gestão; operador e cliente não recebem "perdido"
    assert _alertas(ev, "perdido") == 1
    assert (
        _n(
            f"select count(*) from core.notificacoes where usuario_id = '{u['gestor']}' and tipo = 'agenda_perdido'"
        )
        == 1
    )
    assert (
        _n(
            f"select count(*) from ops.jobs where tipo = 'email_agenda' and payload->>'evento_id' = '{ev}'"
        )
        == 1
    )


def test_nao_marca_perdido_provisorio_protocolado_nem_disputa(cena: Any) -> None:
    conn, emp, ac, _ = cena
    prov = _evento(emp, ac, "impugnacao", _brt(9), provisorio=True)
    feito = _evento(emp, ac, "intencao_recurso", _brt(9), status="protocolado")
    disputa = _evento(emp, ac, "disputa", _brt(9, "10:00"))
    r = processar(conn, AGORA)
    assert r.perdidos == 0
    assert (_status(prov), _status(feito), _status(disputa)) == (
        "sugerido",
        "protocolado",
        "sugerido",
    )


def test_marco_unico_por_rodada_e_idempotente(cena: Any) -> None:
    conn, emp, ac, u = cena
    ev = _evento(emp, ac, "razoes_recurso", _brt(11), status="aprovado")  # amanhã: D-1
    longe = _evento(emp, ac, "contrarrazoes", _brt(20), status="aprovado")  # 10 dias: sem alerta
    processar(conn, AGORA)
    assert _alertas(ev, "D-1") == 2  # gestor e operador; cliente e sem acesso ficam de fora
    assert _alertas(ev, "D-5") == _alertas(ev, "D-3") == 0
    assert _alertas(longe, "D-5") == 0
    antes = _n("select count(*) from core.notificacoes where tipo = 'agenda_prazo'")
    r2 = processar(conn, AGORA)
    assert r2.alertas == 0
    assert _n("select count(*) from core.notificacoes where tipo = 'agenda_prazo'") == antes
    assert _n("select count(*) from ops.jobs where tipo = 'email_agenda'") == 2
    destinos = {
        r[0]
        for r in _admin(
            "select usuario_id::text from priv.agenda_alertas where evento_id = %s and marco = 'D-1'",
            ev,
        )
    }
    assert u["cliente"] not in destinos and u["sem_acesso"] not in destinos
    assert u["gestor"] in destinos and u["operador"] in destinos


def test_escalona_para_gestor_uma_vez_quando_ninguem_agiu(cena: Any) -> None:
    conn, emp, ac, u = cena
    ev = _evento(emp, ac, "razoes_recurso", _brt(12))  # D-2... ainda "sugerido" a 2 dias
    r = processar(conn, AGORA)
    assert r.escalonados == 1
    assert _alertas(ev, "escalonado") == 1
    destinos = _admin(
        "select usuario_id::text from priv.agenda_alertas where evento_id = %s and marco = 'escalonado'",
        ev,
    )
    assert [d[0] for d in destinos] == [u["gestor"]]
    assert processar(conn, AGORA).escalonados == 0


def test_disputa_proxima_alerta_mas_nao_escalona(cena: Any) -> None:
    conn, emp, ac, _ = cena
    ev = _evento(emp, ac, "disputa", _brt(10, "15:00"))  # hoje
    r = processar(conn, AGORA)
    assert _alertas(ev, "D0") == 2
    assert r.escalonados == 0
    assert _status(ev) == "sugerido"


def test_acompanhamento_encerrado_nao_alerta(cena: Any) -> None:
    conn, emp, ac, _ = cena
    ev = _evento(emp, ac, "impugnacao", _brt(9))
    _admin("update priv.acompanhamentos set status = 'encerrado' where id = %s", ac)
    r = processar(conn, AGORA)
    assert r.perdidos == 0 and r.alertas == 0
    assert _status(ev) == "sugerido"
