"""Conversão .docx → PDF com o LibreOffice em modo sem tela (Fase 08, decisão do Adriano em 2026-11-05).

Roda `soffice` como processo filho (lista de argumentos, sem shell), com perfil temporário próprio (sem estado entre
conversões nem conflito entre execuções) e limite de tempo. O conteúdo vem do .docx que o próprio sistema gerou.
"""

import logging
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

log = logging.getLogger("worker.pdf")
LIMITE_SEGUNDOS = 120


class PdfIndisponivel(RuntimeError):
    """LibreOffice ausente ou conversão falhou: a proposta final continua válida, só sem o PDF."""


Executor = Callable[[list[str], int], subprocess.CompletedProcess[bytes]]


def _executar(args: list[str], timeout: int) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(args, capture_output=True, timeout=timeout, check=False)  # noqa: S603 - argumentos fixos, sem shell


def libreoffice_instalado() -> bool:
    return shutil.which("soffice") is not None


def docx_para_pdf(docx: bytes, executor: Executor = _executar) -> bytes:
    soffice = shutil.which("soffice")
    if soffice is None:
        raise PdfIndisponivel("LibreOffice não está instalado neste servidor")
    with tempfile.TemporaryDirectory(prefix="vv-pdf-") as tmp:
        d = Path(tmp)
        origem = d / "proposta.docx"
        origem.write_bytes(docx)
        perfil = d / "perfil"
        try:
            r = executor(
                [
                    soffice,
                    f"-env:UserInstallation=file://{perfil}",
                    "--headless",
                    "--norestore",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    str(d),
                    str(origem),
                ],
                LIMITE_SEGUNDOS,
            )
        except subprocess.TimeoutExpired as e:
            raise PdfIndisponivel("a conversão para PDF demorou demais") from e
        saida = d / "proposta.pdf"
        if r.returncode != 0 or not saida.exists():
            log.error("conversão para PDF falhou", extra={"ctx": {"codigo": r.returncode}})
            raise PdfIndisponivel("a conversão para PDF falhou")
        dados = saida.read_bytes()
    if not dados.startswith(b"%PDF"):
        raise PdfIndisponivel("o arquivo gerado não é um PDF")
    return dados
