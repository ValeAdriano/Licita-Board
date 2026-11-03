import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
import requests
from pywebpush import WebPushException

from worker import push
from worker.push import ENDPOINT_OK, RECUSADO, REDE, EnviadorWebPush, Inscricao, carga_generica
from worker.settings import Settings

INSCRICAO = Inscricao("1", "https://fcm.googleapis.com/fcm/send/abc", "p" * 87, "a" * 22)


def _enviador() -> EnviadorWebPush:
    s = Settings(vapid_private_key="chave-de-teste", vapid_contato="mailto:ti@vv.test")  # type: ignore[arg-type]
    return EnviadorWebPush(s)


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
        "https://web.push.apple.com/abc",
        "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ],
)
def test_aceita_so_servicos_de_push_conhecidos(endpoint: str) -> None:
    assert ENDPOINT_OK.fullmatch(endpoint)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/x",
        "https://evil.example.com/x",
        "https://fcm.googleapis.com@evil.example.com/x",
        "https://127.0.0.1/x",
        "https://169.254.169.254/latest/meta-data",
        "https://fcm.googleapis.com.evil.com/x",
        "https://fcm.googleapis.com:8443/x",
        "https://fcm.googleapis.com/x y",
    ],
)
def test_recusa_endpoint_fora_da_lista_sem_chamar_a_rede(
    endpoint: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    def nao_deve_chamar(*_a: Any, **_k: Any) -> None:
        raise AssertionError("não pode ir à rede")

    monkeypatch.setattr(push, "webpush", nao_deve_chamar)
    inscricao = Inscricao("1", endpoint, "p" * 87, "a" * 22)
    assert _enviador().enviar(inscricao, "{}") == RECUSADO


def test_carga_e_generica_e_nao_leva_conteudo_da_notificacao() -> None:
    carga = json.loads(carga_generica("0190a2b3-0000-7000-8000-000000000001"))
    assert set(carga) == {"titulo", "corpo", "url", "tag"}
    assert carga["url"] == "/notificacoes"  # caminho fixo, do próprio app
    assert "n-0190a2b3" in carga["tag"]


def test_envia_com_vapid_ttl_timeout_e_sem_seguir_redirecionamento(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    visto: dict[str, Any] = {}

    def falso(**kw: Any) -> requests.Response:
        visto.update(kw)
        r = requests.Response()
        r.status_code = 201
        return r

    monkeypatch.setattr(push, "webpush", falso)
    assert _enviador().enviar(INSCRICAO, "{}") == 201
    assert visto["vapid_claims"] == {"sub": "mailto:ti@vv.test"}
    assert visto["ttl"] == push.TTL_SEGUNDOS
    assert visto["timeout"] == 10
    assert visto["requests_session"].max_redirects == 0
    assert visto["subscription_info"]["keys"] == {"p256dh": "p" * 87, "auth": "a" * 22}


def test_traduz_erro_do_servico_de_push_em_status(monkeypatch: pytest.MonkeyPatch) -> None:
    def gone(**_k: Any) -> None:
        r = requests.Response()
        r.status_code = 410
        raise WebPushException("gone", response=r)

    monkeypatch.setattr(push, "webpush", gone)
    assert _enviador().enviar(INSCRICAO, "{}") == 410

    def rede(**_k: Any) -> None:
        raise requests.ConnectionError("sem rede")

    monkeypatch.setattr(push, "webpush", rede)
    assert _enviador().enviar(INSCRICAO, "{}") == REDE

    def sem_resposta(**_k: Any) -> None:
        raise WebPushException("sem resposta")

    monkeypatch.setattr(push, "webpush", sem_resposta)
    assert _enviador().enviar(INSCRICAO, "{}") == REDE


def test_chave_que_nao_e_ponto_valido_da_curva_vira_falha_do_dispositivo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # O banco só confere o formato da chave; o ponto da curva só se vê ao cifrar. Um dispositivo
    # ruim não pode derrubar o envio aos outros do mesmo usuário.
    def quebra(**_k: Any) -> None:
        raise ValueError("Unsupported elliptic curve point type")

    monkeypatch.setattr(push, "webpush", quebra)
    assert _enviador().enviar(INSCRICAO, "{}") == RECUSADO


def test_par_de_chaves_vapid_e_conferido_na_subida() -> None:
    saida = subprocess.run(  # noqa: S603 - roda o script do próprio repositório
        [sys.executable, str(Path(__file__).parents[1] / "scripts" / "gerar_vapid.py")],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    chaves = dict(linha.split("=", 1) for linha in saida.splitlines())
    privada, publica = chaves["VV_VAPID_PRIVATE_KEY"], chaves["VAPID_PUBLIC_KEY"]
    EnviadorWebPush(Settings(vapid_private_key=privada, vapid_public_key=publica))  # type: ignore[arg-type]
    with pytest.raises(ValueError) as erro:
        EnviadorWebPush(Settings(vapid_private_key=privada, vapid_public_key="A" * 87))  # type: ignore[arg-type]
    assert privada not in str(erro.value)
