"""Extração de texto e arquivos de edital (Fase 04). Sem rede; o banco é opcional (VV_ADMIN_URL_TEST)."""

import io
import os
import zipfile
from datetime import UTC, datetime
from typing import Any

import pytest
from openpyxl import Workbook

from tests.test_coleta import AGORA, _admin, _execucao, _n, conn  # noqa: F401
from tests.test_pncp import FakeHttp
from worker.pesquisa.arquivos import baixar, extrair_texto
from worker.pesquisa.coleta import coletar
from worker.pesquisa.http import ErroPermanente
from worker.pesquisa.texto import dividir, extrair, extrair_docx, extrair_pdf, extrair_xlsx


def pdf_simples(*paginas: str) -> bytes:
    """PDF mínimo válido; página com texto vazio vira página sem texto (candidata a OCR)."""
    objs = ["<< /Type /Catalog /Pages 2 0 R >>"]
    ids = [4 + 2 * i for i in range(len(paginas))]
    objs.append(
        f"<< /Type /Pages /Kids [{' '.join(f'{i} 0 R' for i in ids)}] /Count {len(paginas)} >>"
    )
    objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for i, texto in zip(ids, paginas, strict=True):
        fluxo = f"BT /F1 12 Tf 50 700 Td ({texto}) Tj ET" if texto else ""
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {i + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>"
        )
        objs.append(f"<< /Length {len(fluxo)} >>\nstream\n{fluxo}\nendstream")
    out = b"%PDF-1.4\n"
    offs = []
    for n, o in enumerate(objs, start=1):
        offs.append(len(out))
        out += f"{n} 0 obj\n{o}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offs)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


class OcrFalso:
    def reconhecer(self, png: bytes) -> tuple[str, float]:
        assert png[:4] == b"\x89PNG"
        return "Texto lido por OCR da página escaneada", 0.91


def test_pdf_com_texto_guarda_pagina_de_origem() -> None:
    ex = extrair_pdf(
        pdf_simples("Aquisicao de cadeiras escolares", "Segunda pagina do edital"), None
    )
    assert ex.status == "ok" and ex.total_paginas == 2
    assert [(p.numero, p.origem) for p in ex.paginas] == [(1, "texto"), (2, "texto")]
    assert "cadeiras" in ex.paginas[0].texto


def test_pdf_escaneado_usa_ocr_e_registra_confianca() -> None:
    ex = extrair_pdf(pdf_simples("Pagina com texto suficiente aqui", ""), OcrFalso())
    assert ex.status == "ocr"
    assert ex.paginas[1].origem == "ocr" and ex.paginas[1].confianca == 0.91


def test_pdf_escaneado_sem_ocr_e_parcial_nao_ok() -> None:
    ex = extrair_pdf(pdf_simples("Pagina com texto suficiente aqui", ""), None)
    assert [p.numero for p in ex.paginas] == [1]


def test_pdf_corrompido_falha_sem_derrubar() -> None:
    assert extrair_pdf(b"%PDF-1.4 lixo", None).status == "falhou"


def test_planilha_le_valores_e_nunca_formula() -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Itens"
    ws.append(["Item", "Descrição", "Qtd"])
    ws.append([1, "Cadeira escolar", 100])
    ws["D2"] = "=1+1"
    buf = io.BytesIO()
    wb.save(buf)
    ex = extrair_xlsx(buf.getvalue())
    assert ex.status == "ok" and "Cadeira escolar" in ex.paginas[0].texto
    assert (
        "=1+1" not in ex.paginas[0].texto
    )  # fórmula sem cache de valor não é executada nem exibida


def test_docx_extrai_sem_parser_xml_e_ignora_entidade_externa() -> None:
    xml = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><w:document><w:p><w:t>Objeto &amp; prazo &e;</w:t></w:p></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", xml)
    ex = extrair_docx(buf.getvalue())
    assert "Objeto & prazo" in ex.paginas[0].texto
    assert "root:" not in ex.paginas[0].texto  # a entidade não foi resolvida


def test_tipo_nao_suportado_fica_pendente() -> None:
    assert extrair(b"x", "application/zip", None).status == "nao_suportado"
    assert extrair(b"x", "application/msword", None).status == "nao_suportado"


def test_dividir_respeita_limite_e_nao_perde_texto() -> None:
    texto = ("Frase de teste do edital. " * 200).strip()
    partes = dividir(texto, 500)
    assert all(len(p) <= 500 for p in partes) and len(partes) > 1
    assert dividir("   ") == []
    assert "".join(partes).replace(" ", "").replace("\n", "") == texto.replace(" ", "")


# ----------------------------------------------------------------------------- com banco
com_banco = pytest.mark.skipif(not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste")


class S3Falso:
    def __init__(self) -> None:
        self.objetos: dict[str, bytes] = {}

    def gravar(self, chave: str, dados: bytes) -> None:
        self.objetos[chave] = dados

    def ler(self, chave: str) -> bytes:
        return self.objetos[chave]

    def copiar(self, origem: str, destino: str) -> None: ...
    def apagar(self, chave: str) -> None: ...


class AvFalso:
    def varrer(self, dados: bytes) -> str | None:
        return "Eicar-Test-Signature" if b"EICAR" in dados else None


class DownloadFalso:
    def __init__(self, conteudo: bytes | Exception) -> None:
        self.conteudo = conteudo

    def get_bytes(self, url: str, limite: int) -> bytes:
        if isinstance(self.conteudo, Exception):
            raise self.conteudo
        return self.conteudo


def _primeiro_arquivo(conn: Any) -> str:
    coletar(conn, _execucao(), FakeHttp(), AGORA)
    return str(_admin("select id from pub.edital_arquivos order by url_origem limit 1")[0][0])


@com_banco
def test_pdf_liberado_vai_para_o_s3_e_o_texto_vira_trechos(conn: Any) -> None:
    aid = _primeiro_arquivo(conn)
    s3 = S3Falso()
    assert (
        baixar(
            conn,
            aid,
            DownloadFalso(pdf_simples("Aquisicao de cadeiras", "Pagina dois do edital")),
            s3,
            AvFalso(),
        )
        == "liberado"
    )  # type: ignore[arg-type]
    a = _admin(
        "select status_arquivo, sha256, arquivo_chave, tipo_real from pub.edital_arquivos where id = %s",
        aid,
    )[0]
    assert (
        a[0] == "liberado"
        and a[2]
        == f"editais/{_admin('select edital_id from pub.edital_arquivos where id = %s', aid)[0][0]}/{a[1]}"
    )
    assert a[2] in s3.objetos and a[3] == "application/pdf"
    assert _n("select count(*) from ops.jobs where tipo = 'extrair_texto'") == 1
    assert extrair_texto(conn, aid, s3, None, datetime(2026, 11, 4, tzinfo=UTC)) == "ok"  # type: ignore[arg-type]
    assert _n("select count(distinct pagina) from pub.trechos") == 2
    assert _admin("select status_extracao, paginas from pub.edital_arquivos where id = %s", aid)[
        0
    ] == ("ok", 2)
    n = _n("select count(*) from pub.trechos")
    extrair_texto(conn, aid, s3, None, datetime(2026, 11, 4, tzinfo=UTC))  # type: ignore[arg-type]
    assert _n("select count(*) from pub.trechos") == n  # rodar de novo não duplica


@com_banco
def test_arquivo_com_virus_e_bloqueado_e_nada_vai_para_o_s3(conn: Any) -> None:
    aid = _primeiro_arquivo(conn)
    s3 = S3Falso()
    infectado = pdf_simples("Edital") + b"\nEICAR"
    assert baixar(conn, aid, DownloadFalso(infectado), s3, AvFalso()) == "bloqueado"  # type: ignore[arg-type]
    assert _admin("select status_arquivo, motivo from pub.edital_arquivos where id = %s", aid)[
        0
    ] == ("bloqueado", "antivírus: Eicar-Test-Signature")
    assert s3.objetos == {}
    assert _n("select count(*) from pub.editais") == 2  # a oportunidade continua


@com_banco
def test_executavel_renomeado_e_grande_demais_ficam_registrados(conn: Any) -> None:
    aid = _primeiro_arquivo(conn)
    assert (
        baixar(conn, aid, DownloadFalso(b"MZ\x90\x00\x03" + b"\x00" * 200), S3Falso(), AvFalso())
        == "bloqueado"
    )  # type: ignore[arg-type]
    assert (
        "tipo de arquivo não permitido"
        in _admin("select motivo from pub.edital_arquivos where id = %s", aid)[0][0]
    )
    outro = str(_admin("select id from pub.edital_arquivos where id <> %s limit 1", aid)[0][0])
    assert (
        baixar(
            conn,
            outro,
            DownloadFalso(ErroPermanente("arquivo maior que o limite")),
            S3Falso(),
            AvFalso(),
        )
        == "grande_demais"
    )  # type: ignore[arg-type]
    assert (
        _admin("select status_arquivo from pub.edital_arquivos where id = %s", outro)[0][0]
        == "grande_demais"
    )
