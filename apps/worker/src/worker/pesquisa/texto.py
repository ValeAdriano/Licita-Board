"""Extração de texto de arquivos de edital (Fase 04, RF-04.10): PDF por página (com OCR nas páginas
sem texto), planilha (valores, sem fórmulas nem macros), DOCX e imagem. Nada é executado nem
renderizado como HTML; o resultado é texto com arquivo e página de origem (regra 16)."""

import csv
import html
import io
import re
import subprocess
import zipfile
from dataclasses import dataclass, field
from typing import Protocol

LIMITE_PAGINAS = 1000
LIMITE_OCR = 100  # <A DEFINIR>: páginas com OCR por arquivo (tempo do worker)
MIN_TEXTO_PAGINA = 20  # abaixo disso a página é tratada como imagem
TRECHO_MAX = 1500
LIMITE_LINHAS_PLANILHA = 5000
LIMITE_DOCX = 50 * 1024 * 1024  # descompactado


class Ocr(Protocol):
    def reconhecer(self, png: bytes) -> tuple[str, float]:
        """Texto e confiança média (0 a 1)."""


class Tesseract:
    """Tesseract em português por subprocesso (sem rede, com tempo limite)."""

    def __init__(self, idioma: str = "por", tempo: int = 90) -> None:
        self._idioma, self._tempo = idioma, tempo

    def reconhecer(self, png: bytes) -> tuple[str, float]:
        r = subprocess.run(  # noqa: S603 - comando fixo, entrada só por stdin
            ["tesseract", "stdin", "stdout", "-l", self._idioma, "--psm", "3", "tsv"],  # noqa: S607
            input=png,
            capture_output=True,
            timeout=self._tempo,
            check=True,
        )
        linhas: dict[tuple[str, str, str], list[str]] = {}
        confs: list[float] = []
        for row in csv.DictReader(
            io.StringIO(r.stdout.decode("utf-8", "replace")), delimiter="\t", quoting=csv.QUOTE_NONE
        ):
            txt = (row.get("text") or "").strip()
            if row.get("level") != "5" or not txt:
                continue
            linhas.setdefault((row["block_num"], row["par_num"], row["line_num"]), []).append(txt)
            try:
                c = float(row["conf"])
            except ValueError:
                continue
            if c >= 0:
                confs.append(c)
        texto = "\n".join(" ".join(p) for p in linhas.values())
        return texto, (sum(confs) / len(confs) / 100 if confs else 0.0)


@dataclass
class Pagina:
    numero: int
    texto: str
    origem: str = "texto"  # texto | ocr
    confianca: float | None = None


@dataclass
class Extracao:
    paginas: list[Pagina] = field(default_factory=list)
    status: str = "ok"  # ok | ocr | parcial | falhou | nao_suportado
    total_paginas: int = 0


def dividir(texto: str, limite: int = TRECHO_MAX) -> list[str]:
    """Quebra em trechos de até `limite` caracteres, preferindo limites de parágrafo e frase."""
    texto = re.sub(r"[ \t]+", " ", texto.replace("\x00", "")).strip()
    if not texto:
        return []
    saida: list[str] = []
    atual = ""
    for bruto in re.split(r"\n\s*\n|\n", texto):
        par = bruto.strip()
        if not par:
            continue
        while len(par) > limite:  # parágrafo gigante: corta na última frase/espaço
            corte = max(par.rfind(". ", 0, limite), par.rfind(" ", 0, limite))
            corte = corte + 1 if corte > limite // 2 else limite
            if atual:
                saida.append(atual)
                atual = ""
            saida.append(par[:corte].strip())
            par = par[corte:].strip()
        if len(atual) + len(par) + 1 > limite and atual:
            saida.append(atual)
            atual = ""
        if par:
            atual = f"{atual}\n{par}" if atual else par
    if atual:
        saida.append(atual)
    return [s for s in saida if s]


def extrair_pdf(dados: bytes, ocr: Ocr | None) -> Extracao:
    import pypdfium2 as pdfium  # noqa: PLC0415 - só quando há PDF

    try:
        pdf = pdfium.PdfDocument(dados)
    except pdfium.PdfiumError:
        return Extracao(status="falhou")
    total = len(pdf)
    ex = Extracao(total_paginas=total)
    usou_ocr = limitou = False
    ocr_feitos = 0
    for i in range(min(total, LIMITE_PAGINAS)):
        page = pdf[i]
        try:
            tp = page.get_textpage()
            texto = tp.get_text_range().strip()
            tp.close()
            if len(texto) >= MIN_TEXTO_PAGINA:
                ex.paginas.append(Pagina(i + 1, texto))
            elif ocr is not None and ocr_feitos < LIMITE_OCR:
                ocr_feitos += 1
                buf = io.BytesIO()
                page.render(scale=200 / 72).to_pil().save(buf, format="PNG")
                t, conf = ocr.reconhecer(buf.getvalue())
                if t.strip():
                    ex.paginas.append(Pagina(i + 1, t.strip(), "ocr", round(conf, 4)))
                    usou_ocr = True
            else:
                limitou = limitou or ocr is not None  # sem texto e sem OCR possível
        finally:
            page.close()
    pdf.close()
    if total > LIMITE_PAGINAS or limitou:
        ex.status = "parcial"
    elif usou_ocr:
        ex.status = "ocr"
    if not ex.paginas and ex.status != "parcial":
        ex.status = "falhou"
    return ex


def extrair_xlsx(dados: bytes) -> Extracao:
    from openpyxl import load_workbook  # noqa: PLC0415

    try:
        wb = load_workbook(
            io.BytesIO(dados), read_only=True, data_only=True
        )  # valores, nunca fórmula
    except Exception:  # arquivo corrompido ou zip malformado
        return Extracao(status="falhou")
    ex = Extracao(total_paginas=len(wb.sheetnames))
    for n, nome in enumerate(wb.sheetnames, start=1):
        linhas = [f"[{nome}]"]
        for k, row in enumerate(wb[nome].iter_rows(values_only=True)):
            if k >= LIMITE_LINHAS_PLANILHA:
                ex.status = "parcial"
                break
            celulas = [str(c).strip() for c in row if c is not None and str(c).strip()]
            if celulas:
                linhas.append(" | ".join(celulas))
        if len(linhas) > 1:
            ex.paginas.append(Pagina(n, "\n".join(linhas)))
    wb.close()
    if not ex.paginas:
        ex.status = "falhou"
    return ex


def extrair_docx(dados: bytes) -> Extracao:
    """Texto do document.xml sem parser XML (evita entidades maliciosas): tags viram quebras."""
    try:
        with zipfile.ZipFile(io.BytesIO(dados)) as z:
            info = z.getinfo("word/document.xml")
            if info.file_size > LIMITE_DOCX:
                return Extracao(status="falhou")
            xml = z.read(info).decode("utf-8", "replace")
    except (zipfile.BadZipFile, KeyError):
        return Extracao(status="falhou")
    xml = re.sub(r"</w:p>|<w:br[^>]*/>|<w:tab[^>]*/>", "\n", xml)
    texto = html.unescape(re.sub(r"<[^>]+>", "", xml)).strip()
    if not texto:
        return Extracao(status="falhou")
    return Extracao([Pagina(1, texto)], "ok", 1)


def extrair_imagem(dados: bytes, ocr: Ocr | None) -> Extracao:
    if ocr is None:
        return Extracao(status="nao_suportado")
    t, conf = ocr.reconhecer(dados)
    if not t.strip():
        return Extracao(status="falhou", total_paginas=1)
    return Extracao([Pagina(1, t.strip(), "ocr", round(conf, 4))], "ocr", 1)


_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def extrair(dados: bytes, tipo_real: str, ocr: Ocr | None) -> Extracao:
    if tipo_real == "application/pdf":
        return extrair_pdf(dados, ocr)
    if tipo_real == _XLSX:
        return extrair_xlsx(dados)
    if tipo_real == _DOCX:
        return extrair_docx(dados)
    if tipo_real in ("image/jpeg", "image/png"):
        return extrair_imagem(dados, ocr)
    return Extracao(status="nao_suportado")  # .doc/.xls/.odt/zip: pendentes
