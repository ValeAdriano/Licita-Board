from datetime import UTC, datetime

import pytest

from worker.rules.alertas import FUSO, deve_escalonar, dias_restantes, marco_atingido, rotulo_marco

AGORA = datetime(2026, 12, 10, 12, 0, tzinfo=FUSO)


@pytest.mark.parametrize(
    ("dias", "marco"),
    [(10, None), (6, None), (5, 5), (4, 5), (3, 3), (2, 3), (1, 1), (0, 0), (-1, None)],
)
def test_marco_atingido_e_o_mais_urgente(dias: int, marco: int | None) -> None:
    assert marco_atingido(dias) == marco


def test_dias_restantes_conta_dias_de_brasilia() -> None:
    assert dias_restantes(datetime(2026, 12, 15, 23, 59, tzinfo=FUSO), AGORA) == 5
    assert dias_restantes(datetime(2026, 12, 10, 23, 59, tzinfo=FUSO), AGORA) == 0
    assert dias_restantes(datetime(2026, 12, 9, 23, 59, tzinfo=FUSO), AGORA) == -1
    # 02:30 UTC de 11/12 ainda é 23:30 de 10/12 em Brasília: hoje.
    assert dias_restantes(datetime(2026, 12, 11, 2, 30, tzinfo=UTC), AGORA) == 0


def test_escalonamento() -> None:
    assert deve_escalonar("sugerido", 3) and deve_escalonar("sugerido", 0)
    assert not deve_escalonar("sugerido", 4)
    assert deve_escalonar("em_elaboracao", 1) and not deve_escalonar("em_elaboracao", 2)
    assert not deve_escalonar("em_revisao", 1) and not deve_escalonar("aprovado", 0)
    assert not deve_escalonar("sugerido", -1)


def test_rotulos() -> None:
    assert [rotulo_marco(m) for m in (5, 3, 1, 0)] == ["D-5", "D-3", "D-1", "D0"]
