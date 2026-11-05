"""Reavaliação ao retificar o edital (VV_ADMIN_URL_TEST): aviso uma vez, abertura a reconfirmar, aviso de proposta."""

import os
import uuid
from typing import Any

import psycopg
import pytest

from tests.test_coleta import _admin, _n
from worker.agenda_retificacao import reavaliar

pytestmark = pytest.mark.skipif(
    not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste"
)


@pytest.fixture
def cena() -> Any:
    assert _admin("select current_database()")[0][0] != "vv"
    emp = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, 'Retif Teste', '11222333000181')",
        emp,
    )
    gestor = _admin(
        "insert into core.usuarios (email, nome, email_verificado_em) values (%s, 'Gestor', now()) returning id",
        f"r-{uuid.uuid4().hex[:8]}@exemplo.test",
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
        f"RT-{uuid.uuid4()}",
        org,
    )[0][0]
    _admin(
        "insert into pub.edital_versoes (edital_id, versao, hash_conteudo, campos_alterados, conteudo) values (%s, 1, repeat('a', 64), '{}', '{}')",
        ed,
    )
    ac = _admin(
        "insert into priv.acompanhamentos (empresa_id, edital_id, data_abertura, abertura_confirmada, edital_versao_vista) values (%s, %s, now() + interval '20 days', true, 1) returning id",
        emp,
        ed,
    )[0][0]
    conn = psycopg.connect(os.environ["VV_ADMIN_URL_TEST"])
    conn.execute("set role vv_worker")
    conn.commit()
    yield conn, emp, str(ac), str(ed), str(gestor)
    conn.close()
    _admin("delete from priv.acompanhamentos")
    _admin("alter table core.notificacoes disable trigger user")
    _admin("delete from core.notificacoes where empresa_id = %s", emp)
    _admin("alter table core.notificacoes enable trigger user")
    _admin("delete from ops.jobs where tipo = 'calcular_prazos'")
    _admin("alter table core.empresas disable trigger user")
    _admin("delete from core.permissoes where empresa_id = %s", emp)
    _admin("delete from core.vinculos where empresa_id = %s", emp)
    _admin("delete from core.empresas where id = %s", emp)
    _admin("alter table core.empresas enable trigger user")
    _admin("delete from core.usuarios where id = %s", gestor)


def _versao(ed: str, n: int, campos: list[str]) -> None:
    _admin("alter table pub.edital_versoes disable trigger edital_versoes_imutavel")
    _admin(
        "insert into pub.edital_versoes (edital_id, versao, hash_conteudo, campos_alterados, conteudo) values (%s, %s, repeat('b', 64), %s, '{}')",
        ed,
        n,
        campos,
    )
    _admin("alter table pub.edital_versoes enable trigger edital_versoes_imutavel")
    _admin("update pub.editais set versao_atual = %s where id = %s", n, ed)


def _estado(ac: str) -> Any:
    return _admin(
        "select abertura_reconfirmar, retificacao_notificada_versao from priv.acompanhamentos where id = %s",
        ac,
    )[0]


def test_mudanca_de_data_avisa_marca_reconfirmar_e_enfileira_recalculo(cena: Any) -> None:
    conn, _emp, ac, ed, gestor = cena
    _versao(ed, 2, ["data_encerramento_propostas"])
    assert reavaliar(conn) == {"avisados": 1, "reconfirmar": 1}
    assert _estado(ac) == (True, 2)
    corpo = _admin(
        "select corpo from core.notificacoes where usuario_id = %s and tipo = 'agenda_retificacao'",
        gestor,
    )[0][0]
    assert "fim do prazo de propostas" in corpo and "Reconfirme a data de abertura" in corpo
    assert "reabrir o prazo" not in corpo
    assert (
        _n(
            f"select count(*) from ops.jobs where tipo = 'calcular_prazos' and payload->>'acompanhamento_id' = '{ac}'"
        )
        == 1
    )


def test_rodar_de_novo_nao_reavisa(cena: Any) -> None:
    conn, _, _, ed, _ = cena
    _versao(ed, 2, ["situacao"])
    reavaliar(conn)
    assert reavaliar(conn) == {"avisados": 0, "reconfirmar": 0}
    assert _n("select count(*) from core.notificacoes where tipo = 'agenda_retificacao'") == 1


def test_objeto_ou_itens_acrescentam_o_aviso_de_proposta_sem_marcar_data(cena: Any) -> None:
    conn, _, ac, ed, gestor = cena
    _versao(ed, 2, ["itens", "objeto"])
    assert reavaliar(conn) == {"avisados": 1, "reconfirmar": 0}
    assert _estado(ac) == (False, 2)
    corpo = _admin("select corpo from core.notificacoes where usuario_id = %s", gestor)[0][0]
    assert "avalie a necessidade de reabrir o prazo de publicação (decisão sua)" in corpo


def test_varias_versoes_juntam_os_campos_e_encerrado_nao_avisa(cena: Any) -> None:
    conn, _, ac, ed, _ = cena
    _versao(ed, 2, ["arquivos"])
    _versao(ed, 3, ["data_sessao"])
    reavaliar(conn)
    assert _n("select count(*) from core.notificacoes where tipo = 'agenda_retificacao'") == 1
    assert _estado(ac) == (True, 3)
    _admin(
        "update priv.acompanhamentos set status = 'encerrado', abertura_reconfirmar = false where id = %s",
        ac,
    )
    _versao(ed, 4, ["objeto"])
    assert reavaliar(conn)["avisados"] == 0
