"""Gerador mínimo de .docx (Office Open XML) só com a biblioteca padrão: sem dependência nova (Fase 08).

Documento simples e legível (título, parágrafos, uma tabela). O modelo oficial do edital e o papel timbrado exigem os
modelos reais da Operação VV e ficam para o próximo bloco. Todo texto é ESCAPADO (texto de edital é dado, nunca marcação).
"""

import io
import zipfile
from xml.sax.saxutils import escape

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
TIPOS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    "</Types>"
)
RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    "</Relationships>"
)


def _limpa(t: str) -> str:
    """Remove caracteres de controle que o XML 1.0 não admite."""
    return "".join(c for c in t if c in "\t\n\r" or ord(c) >= 32)


def paragrafo(
    texto: str, *, negrito: bool = False, tamanho: int | None = None, centro: bool = False
) -> str:
    rpr = ("<w:b/>" if negrito else "") + (f'<w:sz w:val="{tamanho * 2}"/>' if tamanho else "")
    ppr = '<w:pPr><w:jc w:val="center"/></w:pPr>' if centro else ""
    return f'<w:p>{ppr}<w:r><w:rPr>{rpr}</w:rPr><w:t xml:space="preserve">{escape(_limpa(texto))}</w:t></w:r></w:p>'


def tabela(cabecalho: list[str], linhas: list[list[str]]) -> str:
    def celula(t: str, negrito: bool = False) -> str:
        return f'<w:tc><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tcBorders></w:tcPr>{paragrafo(t, negrito=negrito)}</w:tc>'

    def linha(cs: list[str], negrito: bool = False) -> str:
        return "<w:tr>" + "".join(celula(c, negrito) for c in cs) + "</w:tr>"

    return (
        '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
        + linha(cabecalho, True)
        + "".join(linha(r) for r in linhas)
        + "</w:tbl>"
    )


def montar(corpo_xml: list[str]) -> bytes:
    documento = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W}"><w:body>{"".join(corpo_xml)}<w:sectPr/></w:body></w:document>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", TIPOS)
        z.writestr("_rels/.rels", RELS)
        z.writestr("word/document.xml", documento)
    return buf.getvalue()
