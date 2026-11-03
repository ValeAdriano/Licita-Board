"""Gera o par de chaves VAPID do Web Push. Uso: uv run python scripts/gerar_vapid.py

Imprime as duas variáveis: a privada vai SÓ para o worker (VV_VAPID_PRIVATE_KEY) e a pública para a
API (VAPID_PUBLIC_KEY). Nunca commite o valor da privada.
"""

import base64
import sys

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02


def b64url(dados: bytes) -> str:
    return base64.urlsafe_b64encode(dados).rstrip(b"=").decode()


v = Vapid02()
v.generate_keys()
privada = v.private_key.private_bytes(  # type: ignore[union-attr]
    serialization.Encoding.DER,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)
publica = v.public_key.public_bytes(  # type: ignore[union-attr]
    serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
)
print(
    "# A privada vai SÓ para o worker; não cole em histórico de shell nem commite.", file=sys.stderr
)
print(f"VV_VAPID_PRIVATE_KEY={b64url(privada)}")
print(f"VAPID_PUBLIC_KEY={b64url(publica)}")
