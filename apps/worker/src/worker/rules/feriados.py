"""Feriados nacionais fixos e móveis (Fase 05). Código puro: sem I/O, sem relógio.

Páscoa pelo algoritmo anônimo gregoriano (Meeus/Jones/Butcher). Carnaval e Corpus Christi são pontos
facultativos nacionais; Sexta-feira Santa é feriado. ⚖️ Quem decide como o ponto facultativo conta é o
jurídico (spec fase-05, pergunta 4): aqui ele é devolvido como `ponto_facultativo`, nunca misturado.
"""

from dataclasses import dataclass
from datetime import date, timedelta


@dataclass(frozen=True)
class Feriado:
    data: date
    nome: str
    tipo: str  # feriado | ponto_facultativo


def pascoa(ano: int) -> date:
    a = ano % 19
    b, c = divmod(ano, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    ell = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ell) // 451
    mes, dia = divmod(h + ell - 7 * m + 114, 31)
    return date(ano, mes, dia + 1)


_FIXOS = (
    (1, 1, "Confraternização Universal"),
    (4, 21, "Tiradentes"),
    (5, 1, "Dia do Trabalho"),
    (9, 7, "Independência do Brasil"),
    (10, 12, "Nossa Senhora Aparecida"),
    (11, 2, "Finados"),
    (11, 15, "Proclamação da República"),
    (
        11,
        20,
        "Dia Nacional de Zumbi e da Consciência Negra",
    ),  # nacional desde 2024 (Lei 14.759/2023)
    (12, 25, "Natal"),
)


def feriados_nacionais(ano: int) -> list[Feriado]:
    p = pascoa(ano)
    lista = [Feriado(date(ano, m, d), nome, "feriado") for m, d, nome in _FIXOS]
    if ano < 2024:  # antes da lei, 20/11 não era nacional
        lista = [f for f in lista if not (f.data.month == 11 and f.data.day == 20)]
    lista += [
        Feriado(p - timedelta(days=48), "Carnaval (segunda-feira)", "ponto_facultativo"),
        Feriado(p - timedelta(days=47), "Carnaval (terça-feira)", "ponto_facultativo"),
        Feriado(p - timedelta(days=2), "Sexta-feira Santa", "feriado"),
        Feriado(p + timedelta(days=60), "Corpus Christi", "ponto_facultativo"),
    ]
    return sorted(lista, key=lambda f: f.data)
