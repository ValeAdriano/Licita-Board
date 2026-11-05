"""Rodada horária dos alertas de contratos: chama a função do banco como vv_worker e é idempotente (VV_ADMIN_URL_TEST)."""

import datetime as dt
import os
import uuid
from typing import Any

import psycopg
import pytest

from tests.test_coleta import _admin
from worker.fila import alertas_dos_contratos

pytestmark = pytest.mark.skipif(
    not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste"
)
HOJE = dt.date(2026, 11, 5)


@pytest.fixture
def contrato() -> Any:
    assert _admin("select current_database()")[0][0] != "vv"
    emp = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, 'Contrato Teste', '11222333000181')",
        emp,
    )
    usuario = _admin(
        "insert into core.usuarios (email, nome, email_verificado_em) values (%s, 'Gestor', now()) returning id",
        f"c-{uuid.uuid4().hex[:8]}@exemplo.test",
    )[0][0]
    vin = _admin(
        "insert into core.vinculos (usuario_id, empresa_id, papel) values (%s, %s, 'OPERADOR') returning id",
        usuario,
        emp,
    )[0][0]
    _admin(
        "insert into core.permissoes (vinculo_id, empresa_id, modulo, acao) values (%s, %s, 'contratos', 'visualizar')",
        vin,
        emp,
    )
    _admin(
        "insert into priv.contratos (empresa_id, numero, orgao, objeto, vigencia_inicio, vigencia_fim) values (%s, 'CT-9', 'Órgão', 'Objeto', %s, %s)",
        emp,
        dt.date(2026, 1, 1),
        dt.date(2026, 12, 20),
    )
    conn = psycopg.connect(os.environ["VV_ADMIN_URL_TEST"])
    conn.execute("set role vv_worker")
    conn.commit()
    yield {"conn": conn, "emp": emp, "usuario": usuario}
    conn.close()
    _admin("delete from priv.contrato_notificacoes")
    _admin("delete from core.notificacoes where usuario_id = %s", usuario)
    _admin("delete from priv.contratos where empresa_id = %s", emp)
    _admin("delete from core.permissoes where empresa_id = %s", emp)
    _admin("delete from core.vinculos where empresa_id = %s", emp)
    _admin("alter table core.empresas disable trigger user")
    _admin("delete from core.empresas where id = %s", emp)
    _admin("alter table core.empresas enable trigger user")
    _admin("delete from core.usuarios where id = %s", usuario)


def test_rodada_gera_uma_notificacao_e_nao_repete(contrato: Any) -> None:
    assert alertas_dos_contratos(contrato["conn"], HOJE) == 1  # vigência em 45 dias
    assert alertas_dos_contratos(contrato["conn"], HOJE) == 0
    n = _admin(
        "select titulo, link from core.notificacoes where usuario_id = %s", contrato["usuario"]
    )
    assert len(n) == 1 and n[0][0] == "Vigência do contrato perto do prazo"
