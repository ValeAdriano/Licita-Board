"""Integração com o Postgres de teste (test-local.sh); sem as URLs, os testes são pulados.

VV_DATABASE_URL_TEST: vv_worker no banco vv_test; VV_ADMIN_URL_TEST: superusuário no mesmo banco.
"""

import os
import re
import uuid
from typing import Any

import psycopg
import pytest

from worker.email import Mensagem
from worker.fila import Handlers, processar_lote
from worker.settings import Settings

URL = os.environ.get("VV_DATABASE_URL_TEST", "")
ADMIN = os.environ.get("VV_ADMIN_URL_TEST", "")
pytestmark = pytest.mark.skipif(not (URL and ADMIN), reason="sem banco de teste")


class EnviadorFalso:
    def __init__(self) -> None:
        self.enviadas: list[Mensagem] = []

    def enviar(self, msg: Mensagem) -> None:
        self.enviadas.append(msg)


def _admin(sql: str, *args: Any) -> list[tuple[Any, ...]]:
    with psycopg.connect(ADMIN) as c:
        cur = c.execute(sql, args)
        return cur.fetchall() if cur.description else []


@pytest.fixture
def usuario() -> str:
    email = f"fila-{uuid.uuid4().hex[:8]}@teste.local"
    _admin(
        "insert into core.usuarios (email, nome, email_verificado_em) values (%s, 'Fila', now())",
        email,
    )
    return email


def test_recuperacao_gera_token_que_redefine_a_senha(usuario: str) -> None:
    kek = _admin("select tests.kek()")[0][0]
    _admin("select core.solicitar_recuperacao(%s, %s)", usuario, kek)
    enviador = EnviadorFalso()
    s = Settings(database_url=URL, app_url="http://app.teste")  # type: ignore[arg-type]
    with psycopg.connect(URL) as conn:
        while processar_lote(conn, Handlers(s, enviador).tipos()):
            pass
    msg = next(m for m in enviador.enviadas if m.para == usuario)
    achado = re.search(r"http://app\.teste/redefinir-senha#token=([\w-]{43})", msg.texto)
    assert achado is not None
    hash_falso = "$argon2id$v=19$m=1,t=1,p=1$YQ$YQ"
    ok = _admin("select core.redefinir_senha(%s, %s, %s)", achado.group(1), hash_falso, kek)
    assert ok[0][0] is True
    # O banco nunca guarda o token em claro (só o SHA-256).
    em_claro = "select count(*) from core.tokens_recuperacao "
    em_claro += "where token_hash = convert_to(%s, 'UTF8')"
    assert _admin(em_claro, achado.group(1))[0][0] == 0


def test_falha_do_envio_devolve_o_job_com_backoff(usuario: str) -> None:
    class Quebrado(EnviadorFalso):
        def enviar(self, msg: Mensagem) -> None:
            raise OSError("smtp fora do ar")

    _admin("delete from ops.jobs where tipo = 'email_alerta'")
    _admin(
        "insert into ops.jobs (tipo, payload) select 'email_alerta', "
        "jsonb_build_object('usuario_id', id, 'eventos', jsonb_build_array('senha_alterada')) "
        "from core.usuarios where email = %s",
        usuario,
    )
    s = Settings(database_url=URL)  # type: ignore[arg-type]
    with psycopg.connect(URL) as conn:
        processar_lote(conn, Handlers(s, Quebrado()).tipos())
    status, erro = _admin("select status, ultimo_erro from ops.jobs where tipo = 'email_alerta'")[0]
    assert status == "pendente"
    assert erro == "OSError"  # só o tipo do erro, sem a mensagem
