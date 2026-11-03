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


class PushFalso:
    def __init__(self, status: int | dict[str, int] = 201) -> None:
        self.status = status
        self.enviados: list[tuple[str, str]] = []

    def enviar(self, inscricao: Any, carga: str) -> int:
        self.enviados.append((inscricao.endpoint, carga))
        if isinstance(self.status, dict):
            return self.status.get(inscricao.endpoint, 201)
        return self.status


def _dispositivo_e_notificacao(usuario: str) -> tuple[str, str]:
    """Dispositivo ativo + notificação (que enfileira o push): (endpoint, notificação)."""
    endpoint = f"https://fcm.googleapis.com/fcm/send/{uuid.uuid4().hex}"
    _admin(
        "insert into core.dispositivos_push (usuario_id, endpoint, p256dh, auth) "
        "select id, %s, repeat('A', 87), repeat('B', 22) from core.usuarios where email = %s",
        endpoint,
        usuario,
    )
    notif = _admin(
        "insert into core.notificacoes (usuario_id, tipo, titulo, corpo) "
        "select id, 'sistema', 'TEXTO-SECRETO-DA-NOTIFICACAO', 'corpo secreto' "
        "from core.usuarios where email = %s returning id",
        usuario,
    )[0][0]
    return endpoint, str(notif)


def _processar(push: PushFalso | None) -> None:
    s = Settings(database_url=URL, app_url="http://app.teste")  # type: ignore[arg-type]
    with psycopg.connect(URL) as conn:
        while processar_lote(conn, Handlers(s, EnviadorFalso(), push).tipos()):  # type: ignore[arg-type]
            pass


def _situacao(endpoint: str) -> tuple[Any, ...]:
    return _admin(
        "select ultimo_envio_em is not null, falhas, revogado_em is not null "
        "from core.dispositivos_push where endpoint = %s",
        endpoint,
    )[0]


def test_push_envia_aviso_generico_e_marca_o_envio(usuario: str) -> None:
    endpoint, _ = _dispositivo_e_notificacao(usuario)
    push = PushFalso(201)
    _processar(push)
    ao_dispositivo = [c for e, c in push.enviados if e == endpoint]
    assert len(ao_dispositivo) == 1
    assert "TEXTO-SECRETO" not in ao_dispositivo[0]  # o conteúdo nunca sai pelo push
    assert _situacao(endpoint) == (True, 0, False)


def test_push_revoga_inscricao_que_o_servico_diz_ter_sumido(usuario: str) -> None:
    endpoint, _ = _dispositivo_e_notificacao(usuario)
    _processar(PushFalso(410))
    assert _situacao(endpoint)[2] is True


def test_push_falha_passageira_nao_conta_contra_o_dispositivo_e_volta_para_a_fila(
    usuario: str,
) -> None:
    endpoint, notif = _dispositivo_e_notificacao(usuario)
    _processar(PushFalso(503))
    # Instabilidade do serviço de push (ou nossa) não pode revogar dispositivos aos poucos.
    assert _situacao(endpoint) == (False, 0, False)
    job = _admin(
        "select status, tentativas, ultimo_erro from ops.jobs where chave_idempotencia = %s",
        f"push:{notif}",
    )[0]
    assert job[0] == "pendente"  # volta com backoff
    assert job[2] == "PushTransitorio"


def test_push_desligado_deixa_o_job_na_fila_sem_gastar_tentativa(usuario: str) -> None:
    _, notif = _dispositivo_e_notificacao(usuario)
    _processar(None)
    job = _admin(
        "select status, tentativas from ops.jobs where chave_idempotencia = %s", f"push:{notif}"
    )[0]
    assert job == ("pendente", 0)


def test_push_recusa_definitiva_conta_e_cinco_seguidas_revogam(usuario: str) -> None:
    endpoint, _ = _dispositivo_e_notificacao(usuario)
    _processar(PushFalso(400))
    assert _situacao(endpoint) == (False, 1, False)
    _admin("update core.dispositivos_push set falhas = 4 where endpoint = %s", endpoint)
    _, _ = _dispositivo_e_notificacao(usuario)  # nova notificação -> novo job
    _processar(PushFalso(400))
    assert _situacao(endpoint)[2] is True


def test_push_401_e_erro_de_configuracao_nao_revoga_ninguem(usuario: str) -> None:
    endpoint, notif = _dispositivo_e_notificacao(usuario)
    _processar(PushFalso(403))
    assert _situacao(endpoint) == (False, 0, False)
    job = _admin("select ultimo_erro from ops.jobs where chave_idempotencia = %s", f"push:{notif}")[
        0
    ]
    assert job[0] == "PushConfiguracao"


def test_push_reenvio_depois_de_falha_nao_duplica_para_quem_ja_recebeu(usuario: str) -> None:
    ok, notif = _dispositivo_e_notificacao(usuario)
    ruim = f"https://fcm.googleapis.com/fcm/send/{uuid.uuid4().hex}"
    _admin(
        "insert into core.dispositivos_push (usuario_id, endpoint, p256dh, auth) "
        "select id, %s, repeat('A', 87), repeat('B', 22) from core.usuarios where email = %s",
        ruim,
        usuario,
    )
    push = PushFalso({ruim: 503})
    _processar(push)  # 1ª passada: o bom recebe, o ruim falha e o job volta
    _admin(
        "update ops.jobs set disponivel_em = now() where chave_idempotencia = %s", f"push:{notif}"
    )
    push.status = {}
    _processar(push)  # 2ª passada: só o que ainda não recebeu
    para_o_bom = [e for e, _ in push.enviados if e == ok]
    assert len(para_o_bom) == 1


def test_push_ignora_notificacao_velha(usuario: str) -> None:
    endpoint, notif = _dispositivo_e_notificacao(usuario)
    _admin(
        "update core.notificacoes set created_at = now() - interval '2 days' where id = %s", notif
    )
    push = PushFalso(201)
    _processar(push)
    assert [e for e, _ in push.enviados if e == endpoint] == []
