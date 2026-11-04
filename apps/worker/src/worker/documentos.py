import hashlib
import logging
import socket
import struct
from typing import Any, Protocol

import magic

log = logging.getLogger("worker.documentos")

TAMANHO_MAXIMO = 25 * 1024 * 1024
# Tipos reais aceitos (spec fase-03, pergunta 2): o tipo vem do CONTEÚDO, não da extensão.
TIPOS_PERMITIDOS = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.oasis.opendocument.text",
    "application/msword",
    "application/vnd.ms-excel",
}


class Antivirus(Protocol):
    def varrer(self, dados: bytes) -> str | None:
        """None = limpo; texto = nome da ameaça."""


class Clamd:
    """Cliente mínimo do protocolo INSTREAM do clamd (sem dependência extra)."""

    def __init__(self, host: str, porta: int = 3310, timeout: float = 60.0) -> None:
        self._host, self._porta, self._timeout = host, porta, timeout

    def varrer(self, dados: bytes) -> str | None:
        with socket.create_connection((self._host, self._porta), timeout=self._timeout) as s:
            s.sendall(b"zINSTREAM\0")
            for i in range(0, len(dados), 65536):
                bloco = dados[i : i + 65536]
                s.sendall(struct.pack("!I", len(bloco)) + bloco)
            s.sendall(struct.pack("!I", 0))
            resposta = s.recv(4096).decode("utf-8", "replace").strip("\0\n ")
        if resposta.endswith("OK"):
            return None
        if "FOUND" in resposta:
            return resposta.split(":", 1)[1].replace("FOUND", "").strip() or "ameaça"
        raise RuntimeError(f"resposta inesperada do antivírus: {resposta[:80]}")


class Armazenamento(Protocol):
    def ler(self, chave: str) -> bytes: ...
    def copiar(self, origem: str, destino: str) -> None: ...
    def apagar(self, chave: str) -> None: ...


class Veredito:
    def __init__(
        self,
        status: str,
        tipo_real: str | None,
        tamanho: int,
        sha256: str | None,
        motivo: str | None,
    ) -> None:
        self.status, self.tipo_real, self.tamanho, self.sha256, self.motivo = (
            status,
            tipo_real,
            tamanho,
            sha256,
            motivo,
        )


def verificar(
    dados: bytes,
    antivirus: Antivirus,
    maximo: int = TAMANHO_MAXIMO,
    tipos: set[str] | frozenset[str] = TIPOS_PERMITIDOS,
) -> Veredito:
    """Tamanho, tipo real, antivírus e SHA-256, nessa ordem; o primeiro problema bloqueia."""
    tamanho = len(dados)
    sha = hashlib.sha256(dados).hexdigest()
    if tamanho == 0 or tamanho > maximo:
        limite = f"{maximo // (1024 * 1024)} MB"
        return Veredito("bloqueado", None, tamanho, sha, f"tamanho fora do limite (até {limite})")
    tipo = magic.from_buffer(dados, mime=True)
    if tipo not in tipos:
        return Veredito("bloqueado", tipo, tamanho, sha, f"tipo de arquivo não permitido ({tipo})")
    ameaca = antivirus.varrer(dados)
    if ameaca is not None:
        return Veredito("bloqueado", tipo, tamanho, sha, f"antivírus: {ameaca}")
    return Veredito("liberado", tipo, tamanho, sha, None)


def processar_versao(conn: Any, versao_id: str, s3: Armazenamento, antivirus: Antivirus) -> str:
    """Lê a quarentena, dá o veredito, registra no banco (função só do worker) e move o liberado."""
    with conn.cursor() as cur:
        cur.execute(
            "select arquivo_chave from priv.documento_versoes "
            "where id = %s and status_arquivo = 'quarentena'",
            (versao_id,),
        )
        linha = cur.fetchone()
    if linha is None:
        return "ja_processada"
    quarentena = linha[0]
    v = verificar(s3.ler(quarentena), antivirus)
    with conn.cursor() as cur:
        cur.execute(
            "select priv.registrar_verificacao(%s, %s, %s, %s, %s, %s)",
            (versao_id, v.status, v.tipo_real, v.tamanho, v.sha256, v.motivo),
        )
        chave_final = cur.fetchone()[0]
    if v.status == "liberado":
        s3.copiar(quarentena, chave_final)
    s3.apagar(quarentena)
    log.info("versão verificada", extra={"ctx": {"versao_id": versao_id, "status": v.status}})
    return v.status
