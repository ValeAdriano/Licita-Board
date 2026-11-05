"""Quando alertar e quando escalonar um prazo da agenda (Fase 05, RF-05.12). Código puro: sem I/O nem relógio.

Marcos D-5, D-3, D-1 e no dia (D0): em cada rodada só o marco MAIS URGENTE já atingido vale, então um worker parado
por dias não dispara uma rajada de avisos antigos. Prazo vencido não é alerta: é "Prazo perdido" (outro caminho).
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

FUSO = ZoneInfo("America/Sao_Paulo")
MARCOS = (5, 3, 1, 0)
ABERTOS = ("sugerido", "em_elaboracao", "em_revisao", "aprovado")


def dias_restantes(limite: datetime, agora: datetime) -> int:
    """Dias de calendário (Brasília) entre hoje e o dia do prazo; negativo = já passou o dia."""
    return (limite.astimezone(FUSO).date() - agora.astimezone(FUSO).date()).days


def marco_atingido(dias: int) -> int | None:
    """Menor marco já atingido (5, 3, 1 ou 0); None se falta mais de 5 dias ou se o dia já passou."""
    if dias < 0:
        return None
    return min((m for m in MARCOS if dias <= m), default=None)


def deve_escalonar(status: str, dias: int) -> bool:
    """O gestor é avisado quando ninguém agiu: ainda "Sugerido" a 3 dias, ou ainda sem revisão a 1 dia."""
    if dias < 0:
        return False
    return (status == "sugerido" and dias <= 3) or (
        status in ("sugerido", "em_elaboracao") and dias <= 1
    )


def rotulo_marco(m: int) -> str:
    return "D0" if m == 0 else f"D-{m}"


def hoje_local(agora: datetime) -> date:
    return agora.astimezone(FUSO).date()
