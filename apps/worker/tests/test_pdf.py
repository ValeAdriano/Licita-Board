import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from worker.pdf import PdfIndisponivel, docx_para_pdf


def _ok(args: list[str], timeout: int) -> subprocess.CompletedProcess[bytes]:
    out = Path(args[args.index("--outdir") + 1])
    (out / "proposta.pdf").write_bytes(b"%PDF-1.7 falso")
    return subprocess.CompletedProcess(args, 0, b"", b"")


def test_sem_libreoffice_levanta_pdf_indisponivel() -> None:
    with (
        patch("worker.pdf.shutil.which", return_value=None),
        pytest.raises(PdfIndisponivel, match="não está instalado"),
    ):
        docx_para_pdf(b"x")


def test_converte_com_argumentos_fixos_perfil_proprio_e_sem_shell() -> None:
    visto: dict[str, list[str]] = {}

    def executor(args: list[str], timeout: int) -> subprocess.CompletedProcess[bytes]:
        visto["args"] = args
        assert timeout == 120
        return _ok(args, timeout)

    with patch("worker.pdf.shutil.which", return_value="/usr/bin/soffice"):
        assert docx_para_pdf(b"docx", executor).startswith(b"%PDF")
    a = visto["args"]
    assert a[0] == "/usr/bin/soffice" and "--headless" in a and "--convert-to" in a
    assert any(
        x.startswith("-env:UserInstallation=file://") for x in a
    )  # perfil temporário: sem estado entre conversões


def test_falha_timeout_e_saida_que_nao_e_pdf_viram_pdf_indisponivel() -> None:
    def falha(args: list[str], timeout: int) -> subprocess.CompletedProcess[bytes]:
        return subprocess.CompletedProcess(args, 1, b"", b"erro")

    def demora(args: list[str], timeout: int) -> subprocess.CompletedProcess[bytes]:
        raise subprocess.TimeoutExpired(args, timeout)

    def lixo(args: list[str], timeout: int) -> subprocess.CompletedProcess[bytes]:
        (Path(args[args.index("--outdir") + 1]) / "proposta.pdf").write_bytes(b"nao e pdf")
        return subprocess.CompletedProcess(args, 0, b"", b"")

    with patch("worker.pdf.shutil.which", return_value="/usr/bin/soffice"):
        for ex, msg in ((falha, "falhou"), (demora, "demorou"), (lixo, "não é um PDF")):
            with pytest.raises(PdfIndisponivel, match=msg):
                docx_para_pdf(b"docx", ex)
