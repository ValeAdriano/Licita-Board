"""Confere se uma citação existe no texto de origem (Fase 06, RF-06.3). Código puro.

Sem acento, caixa, espaços repetidos nem quebra de linha; hifenização de fim de linha ("compri-\\nmento") é desfeita.
Citação curta demais não prova nada (acha-se em qualquer lugar) e não é aceita.
"""

import re
import unicodedata

MIN_CARACTERES = 12


def normalizar(texto: str) -> str:
    t = re.sub(r"-\s*\n\s*", "", texto)  # hifenização de fim de linha
    t = "".join(c for c in unicodedata.normalize("NFKD", t) if not unicodedata.combining(c)).lower()
    return re.sub(r"\s+", " ", t).strip()


def contem(citacao: str, fonte: str) -> bool:
    c = normalizar(citacao)
    return len(c) >= MIN_CARACTERES and c in normalizar(fonte)


def pagina_da_citacao(citacao: str, paginas: dict[int, str]) -> int | None:
    """Primeira página (em ordem) que contém a citação, ou None."""
    return next((p for p, t in sorted(paginas.items()) if contem(citacao, t)), None)
