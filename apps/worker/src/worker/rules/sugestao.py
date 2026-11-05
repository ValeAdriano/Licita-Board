"""Regras puras das sugestões de esclarecimento e impugnação (Fase 10, 10.2/10.3): tempestividade, fundamento e viabilidade. Sem I/O nem relógio.

A IA sugere; o código decide o que NÃO pode passar: fundamento fora da base verificada é descartado; viabilidade "alta" ou "média" exige
fundamento verificado (senão cai para "baixa" e fica A CONFIRMAR); prazo vencido = intempestiva (a impugnação não é sugerida como tal).
"""

from datetime import datetime

from worker.rules.citacoes import Entrada, verificar

VIABILIDADES = ("alta", "media", "baixa")


def tempestiva(limite: datetime | None, agora: datetime) -> bool | None:
    """True/False conforme o prazo legal; None se a agenda ainda não tem prazo (a pessoa confere no edital)."""
    if limite is None:
        return None
    return agora <= limite


def fundamento_verificado(texto: str | None, base: list[Entrada]) -> tuple[str | None, bool]:
    """(fundamento a guardar, está na base?). Qualquer citação fora da base descarta o fundamento inteiro."""
    t = (texto or "").strip()
    if not t:
        return None, False
    citacoes = verificar(t, base)
    if any(not c.localizada for c in citacoes):
        return None, False
    return t, bool(citacoes)


def ajustar_viabilidade(
    tipo: str, viabilidade: str | None, na_base: bool
) -> tuple[str | None, str | None]:
    """(viabilidade final, aviso). Esclarecimento não tem viabilidade; impugnação sem fundamento verificado nunca passa de 'baixa'."""
    if tipo != "impugnacao":
        return None, None
    v = viabilidade if viabilidade in VIABILIDADES else "baixa"
    if not na_base and v != "baixa":
        return (
            "baixa",
            "Rebaixada para baixa: sem fundamento na base jurídica verificada (A CONFIRMAR).",
        )
    return v, None
