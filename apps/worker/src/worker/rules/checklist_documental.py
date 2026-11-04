"""Checklist documental (Fase 03, RF-03.10): exigências do edital x documentos da empresa.

Código puro: sem I/O, sem banco, sem IA, sem relógio implícito (`hoje` entra por parâmetro).
Na dúvida nunca diz que está válido: sem data vira DEPENDE_CONFERENCIA, sem arquivo vira AUSENTE.
"""

from dataclasses import dataclass
from datetime import date
from enum import StrEnum


class Situacao(StrEnum):
    VALIDO = "valido"
    VENCIDO = "vencido"
    VENCE_ANTES_DA_SESSAO = "vence_antes_da_sessao"
    AUSENTE = "ausente"
    NAO_APLICAVEL = "nao_aplicavel"
    DEPENDE_CONFERENCIA = "depende_conferencia"


# ⚖️ VALIDAR JURÍDICO: sinalização ME/EPP (LC 123/2006, art. 43, §1º). Não altera a situação.
AVISO_ME_EPP = (
    "ME/EPP: a regularização fiscal tardia não dispensa o documento. "
    "A CONFIRMAR com o jurídico antes de depender de prazo de regularização."
)


@dataclass(frozen=True)
class Exigencia:
    tipo: str  # slug de pub.tipos_documento
    aplicavel: bool = True
    conferencia_manual: bool = (
        False  # edital pede algo que só uma pessoa confere (ex.: balanço do exercício)
    )
    regularidade_fiscal: bool = False  # certidões fiscais e trabalhistas (para o aviso ME/EPP)


@dataclass(frozen=True)
class DocumentoEmpresa:
    """Versão liberada mais recente de um documento da empresa."""

    tipo: str
    validade: date | None
    sem_vencimento: bool = False


@dataclass(frozen=True)
class ItemChecklist:
    tipo: str
    situacao: Situacao
    validade: date | None
    dias_para_vencer: int | None  # negativo = vencido há N dias; None sem data
    aviso: str | None = None


def _melhor(docs: list[DocumentoEmpresa]) -> DocumentoEmpresa | None:
    """Entre vários do mesmo tipo vale o de maior validade (sem vencimento vence todos)."""
    if not docs:
        return None
    return max(docs, key=lambda d: (d.sem_vencimento, d.validade or date.min))


def _situacao(doc: DocumentoEmpresa, hoje: date, sessao: date | None) -> Situacao:
    if doc.sem_vencimento:
        return Situacao.VALIDO
    if doc.validade is None:
        return Situacao.DEPENDE_CONFERENCIA
    if doc.validade < hoje:
        return Situacao.VENCIDO
    if sessao is not None and doc.validade < sessao:
        return Situacao.VENCE_ANTES_DA_SESSAO
    return Situacao.VALIDO


def checklist_documental(
    exigencias: list[Exigencia],
    documentos: list[DocumentoEmpresa],
    hoje: date,
    data_sessao: date | None = None,
    me_epp: bool = False,
) -> list[ItemChecklist]:
    itens: list[ItemChecklist] = []
    for e in exigencias:
        if not e.aplicavel:
            itens.append(ItemChecklist(e.tipo, Situacao.NAO_APLICAVEL, None, None))
            continue
        doc = _melhor([d for d in documentos if d.tipo == e.tipo])
        if doc is None:
            situacao = Situacao.DEPENDE_CONFERENCIA if e.conferencia_manual else Situacao.AUSENTE
            itens.append(ItemChecklist(e.tipo, situacao, None, None, _aviso(e, situacao, me_epp)))
            continue
        situacao = (
            Situacao.DEPENDE_CONFERENCIA
            if e.conferencia_manual
            else _situacao(doc, hoje, data_sessao)
        )
        dias = None if doc.sem_vencimento or doc.validade is None else (doc.validade - hoje).days
        itens.append(
            ItemChecklist(e.tipo, situacao, doc.validade, dias, _aviso(e, situacao, me_epp))
        )
    return itens


def _aviso(e: Exigencia, situacao: Situacao, me_epp: bool) -> str | None:
    problema = {Situacao.VENCIDO, Situacao.VENCE_ANTES_DA_SESSAO, Situacao.AUSENTE}
    return AVISO_ME_EPP if me_epp and e.regularidade_fiscal and situacao in problema else None
