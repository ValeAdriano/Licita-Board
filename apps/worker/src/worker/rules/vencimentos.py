"""Documentos da empresa que vencem antes da abertura do edital (Fase 05, RF-05.15). Código puro: sem I/O nem relógio.

Fato, não regra jurídica: a validade vem do documento cadastrado. O documento vale até o fim do dia da validade,
então só "vence antes" o que tem validade ESTRITAMENTE anterior ao dia da abertura (em Brasília).
"""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Documento:
    descricao: str
    validade: date
    em_atualizacao: bool = False


def vencem_antes(docs: list[Documento], dia_abertura: date) -> list[Documento]:
    """Os que vencem antes do dia da abertura, do que vence primeiro para o último."""
    return sorted(
        (d for d in docs if d.validade < dia_abertura), key=lambda d: (d.validade, d.descricao)
    )


def resumo(docs: list[Documento], dia_abertura: date, hoje: date, max_itens: int = 4) -> str:
    """Texto curto (cabe em 500 caracteres) para o aviso do evento e a notificação."""
    if not docs:
        return ""
    partes = []
    for d in docs[:max_itens]:
        estado = "VENCIDO" if d.validade < hoje else f"vence {d.validade:%d/%m/%Y}"
        extra = ", em atualização" if d.em_atualizacao else ""
        partes.append(f"{d.descricao[:60]} ({estado}{extra})")
    resto = f" e mais {len(docs) - max_itens}" if len(docs) > max_itens else ""
    n = len(docs)
    return (
        f"{n} documento(s) vencem antes da abertura de {dia_abertura:%d/%m/%Y}: {'; '.join(partes)}{resto}"
    )[:500]
