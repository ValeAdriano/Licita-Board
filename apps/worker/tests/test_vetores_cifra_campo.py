"""Confere em Python os vetores da cifra de campo em envelope (ADR-017), gerados pela API (TS).

O worker ainda não decifra nada; este teste prova que o formato é implementável do outro lado e
fixa o contrato: se a API mudar o formato, os vetores em docs/referencia/cifra-campo-vetores.json
mudam e este teste (e o da API) quebram juntos.
"""

import base64
import hashlib
import hmac
import json
from pathlib import Path
from typing import Any

import pytest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

VETORES: dict[str, Any] = json.loads(
    (
        Path(__file__).resolve().parents[3] / "docs" / "referencia" / "cifra-campo-vetores.json"
    ).read_text(encoding="utf-8")
)


def derivar(segredo: str, info: str) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info.encode()).derive(
        segredo.encode()
    )


def decifrar(envelope: dict[str, Any], segredo: str, contexto: str) -> str:
    kek = derivar(segredo, "vv-campo-kek-v1")
    dek_cifrada = base64.b64decode(envelope["dek"])
    dek = AESGCM(kek).decrypt(dek_cifrada[:12], dek_cifrada[12:], f"dek|{contexto}".encode())
    iv = base64.b64decode(envelope["iv"])
    return (
        AESGCM(dek)
        .decrypt(iv, base64.b64decode(envelope["ct"]), f"dado|{contexto}".encode())
        .decode()
    )


def test_python_decifra_o_envelope_da_api() -> None:
    assert (
        decifrar(VETORES["envelope"], VETORES["segredo"], VETORES["contexto"]) == VETORES["texto"]
    )


def test_python_gera_o_mesmo_envelope_com_a_mesma_aleatoriedade() -> None:
    kek = derivar(VETORES["segredo"], "vv-campo-kek-v1")
    dek = bytes.fromhex(VETORES["dek_hex"])
    iv = bytes.fromhex(VETORES["iv_hex"])
    iv_dek = bytes.fromhex(VETORES["iv_dek_hex"])
    ct = AESGCM(dek).encrypt(iv, VETORES["texto"].encode(), f"dado|{VETORES['contexto']}".encode())
    dek_cifrada = iv_dek + AESGCM(kek).encrypt(iv_dek, dek, f"dek|{VETORES['contexto']}".encode())
    assert base64.b64encode(ct).decode() == VETORES["envelope"]["ct"]
    assert base64.b64encode(dek_cifrada).decode() == VETORES["envelope"]["dek"]
    assert base64.b64encode(iv).decode() == VETORES["envelope"]["iv"]


def test_contexto_errado_nao_decifra() -> None:
    with pytest.raises(InvalidTag):
        decifrar(
            VETORES["envelope"], VETORES["segredo"], VETORES["contexto"].replace("0001", "0002")
        )


def test_marca_hmac_confere() -> None:
    chave = derivar(VETORES["segredo"], "vv-campo-hmac-v1")
    h = VETORES["hmac"]
    marca = hmac.new(chave, f"{h['dominio']}\0{h['valor']}".encode(), hashlib.sha256).hexdigest()
    assert marca == h["marca"]
