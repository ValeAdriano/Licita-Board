"""Decifra campos em envelope (ADR-017): AES-256-GCM com DEK cifrada pela KEK, contexto como dado autenticado (AAD).

Mesmo formato da API (cifra-campo.ts); os vetores compartilhados em docs/referencia/cifra-campo-vetores.json garantem que os dois lados
concordam. O worker só decifra, no momento de usar (ex.: chave do provedor de IA); nunca grava nem loga o texto aberto.
"""

import base64
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


class ErroDecifrar(RuntimeError):
    """Qualquer problema (envelope malformado, contexto errado, dado adulterado, outra KEK) vira o mesmo erro, sem detalhe."""


def _kek(segredo: str) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"vv-campo-kek-v1").derive(
        segredo.encode()
    )


def decifrar(envelope: dict[str, Any], segredo: str, contexto: str) -> str:
    if len(segredo) < 32:
        raise ErroDecifrar("Falha ao decifrar.")
    try:
        if envelope.get("v") != 1:
            raise ValueError("versão")
        dek_cifrada = base64.b64decode(envelope["dek"])
        if len(dek_cifrada) != 12 + 32 + 16:
            raise ValueError("dek")
        dek = AESGCM(_kek(segredo)).decrypt(
            dek_cifrada[:12], dek_cifrada[12:], f"dek|{contexto}".encode()
        )
        iv = base64.b64decode(envelope["iv"])
        if len(iv) != 12:
            raise ValueError("iv")
        return (
            AESGCM(dek)
            .decrypt(iv, base64.b64decode(envelope["ct"]), f"dado|{contexto}".encode())
            .decode()
        )
    except (InvalidTag, ValueError, KeyError, TypeError):
        raise ErroDecifrar("Falha ao decifrar.") from None


def contexto_chave_ia(empresa_id: str) -> str:
    """Mesmo contexto que a API usa ao cifrar (priv.empresa_ia.chave da empresa, em minúsculas)."""
    return f"priv.empresa_ia.chave|{str(empresa_id).lower()}"
