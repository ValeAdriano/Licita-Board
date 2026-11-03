"""Web Push (ADR-018, spec fase-01 RF-01.15): envio do aviso genérico ao navegador inscrito.

- O push nunca leva o conteúdo da notificação: só "você tem uma nova notificação, abra o app". Quem
  abre o app vê o texto, que passa pela API (sessão, permissão e RLS).
- SSRF: o worker faz POST no endpoint de uma inscrição que veio do usuário. Só hosts de serviços de
  push conhecidos, em https, e sem seguir redirecionamento (a mesma lista vive no banco e na API).
- Chave privada VAPID só aqui (VV_VAPID_PRIVATE_KEY); a API só conhece a pública.
"""

import base64
import json
import re
from dataclasses import dataclass
from typing import Protocol

import requests
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush

from worker.settings import Settings

ENDPOINT_OK = re.compile(
    r"https://(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com"
    r"|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[!-~]+"
)
RECUSADO = -1  # endpoint fora da lista: nada foi enviado
REDE = 0  # erro de rede ou tempo esgotado
TTL_SEGUNDOS = 24 * 3600


@dataclass(frozen=True)
class Inscricao:
    id: str
    endpoint: str
    p256dh: str
    auth: str


class EnviadorPush(Protocol):
    def enviar(self, inscricao: Inscricao, carga: str) -> int:
        """Devolve o status HTTP do serviço de push (RECUSADO e REDE são códigos nossos)."""


def carga_generica(notificacao_id: str) -> str:
    """Texto fixo + etiqueta que junta repetições; nada do conteúdo da notificação."""
    return json.dumps(
        {
            "titulo": "VV Licitações",
            "corpo": "Você tem uma nova notificação. Abra o app para ver.",
            "url": "/notificacoes",
            "tag": f"n-{notificacao_id}",
        },
        ensure_ascii=False,
    )


def _par_confere(privada: str, publica: str) -> bool:
    """A pública (ponto P-256 não comprimido, base64url) derivada da privada (DER base64url)."""
    try:
        chave = Vapid02.from_string(privada)
        bruto = chave.public_key.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
    except Exception:
        return False
    return base64.urlsafe_b64encode(bruto).rstrip(b"=").decode() == publica


class EnviadorWebPush:
    def __init__(self, settings: Settings) -> None:
        self._chave = settings.vapid_private_key.get_secret_value()
        self._contato = settings.vapid_contato
        if settings.vapid_public_key and not _par_confere(self._chave, settings.vapid_public_key):
            # Sem repetir nenhuma das chaves na mensagem.
            raise ValueError("VV_VAPID_PUBLIC_KEY não é a pública do par de VV_VAPID_PRIVATE_KEY")

    def enviar(self, inscricao: Inscricao, carga: str) -> int:
        if not ENDPOINT_OK.fullmatch(inscricao.endpoint):
            return RECUSADO
        sessao = requests.Session()
        # Redirecionamento do serviço de push levaria o POST para outro host.
        sessao.max_redirects = 0
        try:
            resposta = webpush(
                subscription_info={
                    "endpoint": inscricao.endpoint,
                    "keys": {"p256dh": inscricao.p256dh, "auth": inscricao.auth},
                },
                data=carga,
                vapid_private_key=self._chave,
                vapid_claims={"sub": self._contato},
                ttl=TTL_SEGUNDOS,
                timeout=10,
                requests_session=sessao,
            )
        except WebPushException as e:
            return e.response.status_code if e.response is not None else REDE
        except requests.RequestException:
            return REDE
        except Exception:  # chave p256dh que não é ponto válido da curva, etc.
            # O banco não valida o ponto da curva: um dispositivo ruim não derruba o job dos outros.
            return RECUSADO
        return resposta.status_code if isinstance(resposta, requests.Response) else REDE
