"""Cruzamento documentos x abertura com banco (VV_ADMIN_URL_TEST): cria, atualiza, resolve, respeita decisão humana."""

import os
import uuid
from datetime import UTC, datetime
from typing import Any

import psycopg
import pytest

from tests.test_coleta import _admin, _n
from worker.agenda_documentos import cruzar_todos

pytestmark = pytest.mark.skipif(
    not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste"
)
AGORA = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)
ABERTURA = datetime(2026, 12, 16, 13, 0, tzinfo=UTC)  # 10:00 em Brasília


@pytest.fixture
def cena() -> Any:
    assert _admin("select current_database()")[0][0] != "vv"
    emp = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, 'Docs Teste', '11222333000181')",
        emp,
    )
    gestor = _admin(
        "insert into core.usuarios (email, nome, email_verificado_em) values (%s, 'Gestor', now()) returning id",
        f"g-{uuid.uuid4().hex[:8]}@exemplo.test",
    )[0][0]
    vid = _admin(
        "insert into core.vinculos (usuario_id, empresa_id, papel) values (%s, %s, 'ADMIN_EMPRESA') returning id",
        gestor,
        emp,
    )[0][0]
    _admin(
        "insert into core.permissoes (vinculo_id, empresa_id, modulo, acao) values (%s, %s, 'agenda', 'visualizar')",
        vid,
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
        f"DC-{uuid.uuid4()}",
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
    yield conn, emp, str(ac), str(gestor)
    conn.close()
    _admin("alter table priv.agenda_evento_historico disable trigger agenda_historico_imutavel")
    _admin("delete from priv.agenda_evento_historico")
    _admin("delete from priv.agenda_eventos")
    _admin("delete from priv.acompanhamentos")
    _admin("alter table priv.agenda_evento_historico enable trigger agenda_historico_imutavel")
    _admin("alter table core.notificacoes disable trigger user")
    _admin("delete from core.notificacoes where empresa_id = %s", emp)
    _admin("alter table core.notificacoes enable trigger user")
    _admin("alter table core.empresas disable trigger user")
    _admin("delete from priv.documentos where empresa_id = %s", emp)
    _admin("delete from core.permissoes where empresa_id = %s", emp)
    _admin("delete from core.vinculos where empresa_id = %s", emp)
    _admin("delete from core.empresas where id = %s", emp)
    _admin("alter table core.empresas enable trigger user")
    _admin("delete from core.usuarios where id = %s", gestor)


def _doc(emp: str, nome: str, validade: str | None, **kw: Any) -> str:
    tipo = _admin("select id from pub.tipos_documento limit 1")[0][0]
    d = _admin(
        "insert into priv.documentos (empresa_id, tipo_id, descricao, sem_vencimento, em_atualizacao) values (%s, %s, %s, %s, %s) returning id",
        emp,
        tipo,
        nome,
        kw.get("sem_vencimento", False),
        kw.get("em_atualizacao", False),
    )[0][0]
    _admin(
        "insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, validade, status_arquivo) "
        "values (%s, %s, 1, %s, 'a.pdf', %s, 'liberado')",
        d,
        emp,
        f"k/{uuid.uuid4()}",
        validade,
    )
    return str(d)


def _evento(ac: str) -> Any:
    r = _admin(
        "select status, aviso_calculo, data_limite_legal at time zone 'America/Sao_Paulo', provisorio, regra_validada "
        "from priv.agenda_eventos where acompanhamento_id = %s and tipo = 'documento_vence'",
        ac,
    )
    return r[0] if r else None


def test_cria_evento_com_o_primeiro_vencimento_e_avisa_o_gestor(cena: Any) -> None:
    conn, emp, ac, gestor = cena
    _doc(emp, "CND Federal", "2026-12-10")
    _doc(emp, "FGTS", "2026-12-01")
    _doc(emp, "Contrato social", "2027-06-01")
    _doc(emp, "Alvará", None, sem_vencimento=True)
    assert cruzar_todos(conn, AGORA)["criado"] == 1
    ev = _evento(ac)
    assert ev[0] == "sugerido" and ev[3] is False and ev[4] is True
    assert ev[2] == datetime(2026, 12, 1, 23, 59)
    assert "2 documento(s) vencem antes da abertura de 16/12/2026" in ev[1]
    assert "FGTS" in ev[1] and "CND Federal" in ev[1] and "Contrato social" not in ev[1]
    assert (
        _n(
            f"select count(*) from core.notificacoes where usuario_id = '{gestor}' and tipo = 'agenda_documento'"
        )
        == 1
    )


def test_rodar_de_novo_nao_duplica_nem_reavisa(cena: Any) -> None:
    conn, emp, ac, _ = cena
    _doc(emp, "FGTS", "2026-12-01")
    cruzar_todos(conn, AGORA)
    r = cruzar_todos(conn, AGORA)
    assert r == {"criado": 0, "atualizado": 0, "resolvido": 0}
    assert _n("select count(*) from core.notificacoes where tipo = 'agenda_documento'") == 1
    assert _n(f"select count(*) from priv.agenda_eventos where acompanhamento_id = '{ac}'") == 1


def test_renovar_resolve_e_novo_vencimento_reabre(cena: Any) -> None:
    conn, emp, ac, _ = cena
    d = _doc(emp, "FGTS", "2026-12-01")
    cruzar_todos(conn, AGORA)
    _admin(
        "insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, validade, status_arquivo) "
        "values (%s, %s, 2, 'k/novo', 'b.pdf', '2027-05-01', 'liberado')",
        d,
        emp,
    )
    assert cruzar_todos(conn, AGORA)["resolvido"] == 1
    assert _evento(ac)[0] == "dispensado"
    _admin(
        "update priv.documento_versoes set validade = '2026-12-05' where documento_id = %s and versao = 2",
        d,
    )
    assert cruzar_todos(conn, AGORA)["atualizado"] == 1
    assert _evento(ac)[0] == "sugerido"


def test_dispensa_humana_nao_e_reaberta(cena: Any) -> None:
    conn, emp, ac, _ = cena
    _doc(emp, "FGTS", "2026-12-01")
    cruzar_todos(conn, AGORA)
    _admin(
        "update priv.agenda_eventos set status = 'dispensado', justificativa = 'Já renovado, aguardando upload' where acompanhamento_id = %s",
        ac,
    )
    _doc(emp, "CND Estadual", "2026-12-02")
    r = cruzar_todos(conn, AGORA)
    assert r["atualizado"] == 0
    assert _evento(ac)[0] == "dispensado"


def test_abertura_provisoria_ou_passada_nao_gera_evento(cena: Any) -> None:
    conn, emp, ac, _ = cena
    _doc(emp, "FGTS", "2026-12-01")
    _admin("update priv.acompanhamentos set abertura_confirmada = false where id = %s", ac)
    assert cruzar_todos(conn, AGORA)["criado"] == 0
    _admin("update priv.acompanhamentos set abertura_confirmada = true where id = %s", ac)
    assert cruzar_todos(conn, datetime(2026, 12, 20, tzinfo=UTC))["criado"] == 0
    assert _evento(ac) is None
