"""Conferência de citações jurídicas contra a base verificada (Fase 10, 10.1). Código puro: sem I/O nem relógio.

"Proibido citar artigo, acórdão ou súmula que não esteja na base": extrai do texto de uma minuta cada citação reconhecível e confere
na base. Qualquer citação NÃO localizada bloqueia. O texto da minuta é dado: aqui só se lê, nunca se executa nada dele.

Reconhece: Lei/Lei Complementar/Decreto "n/ano", "art. N" (com letra, ex. 74-A), Acórdão "n/ano", Súmula "n" (com órgão opcional) e
Constituição Federal. Um artigo só vale se alguma entrada da base tem esse dispositivo; uma norma só vale se estiver na base.
"""

import re
from dataclasses import dataclass

TIPOS_NORMA = {
    "lei": "lei",
    "lei complementar": "lei_complementar",
    "lc": "lei_complementar",
    "decreto": "decreto",
    "decreto-lei": "decreto",
}
NORMA = re.compile(
    r"(?P<t>Lei\s+Complementar|LC|Lei|Decreto-Lei|Decreto)\s*(?:n[º°o.]*\s*)?(?P<n>\d{1,3}(?:\.\d{3})*|\d+)\s*/\s*(?P<a>\d{4})",
    re.IGNORECASE,
)
ACORDAO = re.compile(
    r"Ac[óo]rd[ãa]o\s*(?:n[º°o.]*\s*)?(?P<n>\d{1,5}(?:\.\d{3})*)\s*/\s*(?P<a>\d{4})", re.IGNORECASE
)
SUMULA = re.compile(
    r"S[úu]mula\s*(?:Vinculante\s*)?(?:n[º°o.]*\s*)?(?P<n>\d+)(?P<o>\s*(?:/|-|do|da|de)?\s*(?:TCU|STJ|STF|TCE-[A-Z]{2}))?",
    re.IGNORECASE,
)
ARTIGO = re.compile(
    r"\bart(?:igos?|s)?\.?\s*(?P<n>\d+)\s*[º°o]?(?:\s*-\s*(?P<l>[A-Z])\b)?", re.IGNORECASE
)
CONSTITUICAO = re.compile(r"Constitui[çc][ãa]o\s+Federal|\bCF\s*/\s*88\b|\bCRFB\b", re.IGNORECASE)


@dataclass(frozen=True)
class Entrada:
    """Uma entrada VERIFICADA da base jurídica."""

    tipo: str  # lei, lei_complementar, decreto, regulamento, acordao, sumula, constituicao
    numero: str | None = None  # "14.133/2021" (norma/acórdão) ou "247" (súmula)
    orgao: str | None = None  # TCU, STJ... (súmula/acórdão)
    dispositivo: str | None = None  # "art. 165"


@dataclass(frozen=True)
class Citacao:
    trecho: str
    categoria: str
    chave: str
    localizada: bool


def _digitos(n: str) -> str:
    return re.sub(r"[^\d/]", "", n)


def _artigo(d: str | None) -> str | None:
    if not d:
        return None
    m = ARTIGO.search(d)
    return f"{m.group('n')}{(m.group('l') or '').upper()}" if m else None


def chaves_da_base(base: list[Entrada]) -> set[tuple[str, str]]:
    ks: set[tuple[str, str]] = set()
    for e in base:
        if e.tipo == "constituicao":
            ks.add(("constituicao", "cf"))
        elif e.numero:
            ks.add((e.tipo if e.tipo != "regulamento" else "decreto", _digitos(e.numero)))
        a = _artigo(e.dispositivo)
        if a:
            ks.add(("art", a))
    return ks


def verificar(texto: str, base: list[Entrada]) -> list[Citacao]:
    ks = chaves_da_base(base)
    orgaos_sumula = {
        (_digitos(e.numero or ""), (e.orgao or "").upper()) for e in base if e.tipo == "sumula"
    }
    out: list[Citacao] = []
    for m in NORMA.finditer(texto):
        chave = (
            TIPOS_NORMA[re.sub(r"\s+", " ", m.group("t").lower())],
            f"{_digitos(m.group('n'))}/{m.group('a')}",
        )
        out.append(Citacao(m.group(0).strip(), chave[0], f"{chave[0]}:{chave[1]}", chave in ks))
    for m in ACORDAO.finditer(texto):
        chave = ("acordao", f"{_digitos(m.group('n'))}/{m.group('a')}")
        out.append(Citacao(m.group(0).strip(), "acordao", f"acordao:{chave[1]}", chave in ks))
    for m in SUMULA.finditer(texto):
        n = m.group("n")
        orgao = (
            re.sub(r"[^A-Za-z-]", "", (m.group("o") or ""))
            .upper()
            .replace("DO", "")
            .replace("DA", "")
            .replace("DE", "")
            if m.group("o")
            else ""
        )
        orgao = orgao if orgao in ("TCU", "STJ", "STF") or orgao.startswith("TCE-") else ""
        ok = ("sumula", n) in ks and (not orgao or (n, orgao) in orgaos_sumula)
        out.append(Citacao(m.group(0).strip(), "sumula", f"sumula:{orgao or '-'}:{n}", ok))
    for m in ARTIGO.finditer(texto):
        a = f"{m.group('n')}{(m.group('l') or '').upper()}"
        out.append(Citacao(m.group(0).strip(), "artigo", f"art:{a}", ("art", a) in ks))
    for m in CONSTITUICAO.finditer(texto):
        out.append(
            Citacao(
                m.group(0).strip(), "constituicao", "constituicao:cf", ("constituicao", "cf") in ks
            )
        )
    return out


def nao_localizadas(texto: str, base: list[Entrada]) -> list[Citacao]:
    return [c for c in verificar(texto, base) if not c.localizada]
