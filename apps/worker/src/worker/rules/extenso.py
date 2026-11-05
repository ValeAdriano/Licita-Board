"""Valor monetário por extenso em português do Brasil (Fase 07 §7.3 / Fase 08). Código puro, só `Decimal`.

Convenções: "e" entre os grupos quando o último grupo é menor que 100 ou centena redonda ("mil e cem", "dois mil e três",
mas "mil duzentos e trinta"); "de reais" quando o valor é múltiplo exato de milhão (e sem milhar/unidades); "cem" para 100
e "cento e" de 101 a 199; "um real", "um centavo". Até 999 trilhões. Centavos vêm de um `Decimal` com no máximo 2 casas
(mais casas é erro: arredonde ANTES, com a regra do edital).
"""

from decimal import Decimal

UNIDADES = ("zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove")  # fmt: skip
DEZENAS = (
    "",
    "",
    "vinte",
    "trinta",
    "quarenta",
    "cinquenta",
    "sessenta",
    "setenta",
    "oitenta",
    "noventa",
)
CENTENAS = (
    "",
    "cento",
    "duzentos",
    "trezentos",
    "quatrocentos",
    "quinhentos",
    "seiscentos",
    "setecentos",
    "oitocentos",
    "novecentos",
)
ESCALAS = (
    ("", ""),
    ("mil", "mil"),
    ("milhão", "milhões"),
    ("bilhão", "bilhões"),
    ("trilhão", "trilhões"),
)
LIMITE = Decimal(10) ** 15


def _centena(n: int) -> str:
    """0 < n < 1000."""
    if n == 100:
        return "cem"
    c, resto = divmod(n, 100)
    partes = [CENTENAS[c]] if c else []
    if resto:
        if resto < 20:
            partes.append(UNIDADES[resto])
        else:
            d, u = divmod(resto, 10)
            partes.append(DEZENAS[d] + (f" e {UNIDADES[u]}" if u else ""))
    return " e ".join(partes)


def inteiro_por_extenso(n: int) -> str:
    if n < 0 or n >= LIMITE:
        raise ValueError("fora do limite (0 a 999 trilhões)")
    if n == 0:
        return "zero"
    grupos: list[int] = []
    while n:
        n, g = divmod(n, 1000)
        grupos.append(g)
    textos: list[str] = []
    for i in range(len(grupos) - 1, -1, -1):
        g = grupos[i]
        if g == 0:
            continue
        if i == 1 and g == 1:
            textos.append("mil")
        elif i >= 2:
            sing, plur = ESCALAS[i]
            textos.append(f"{_centena(g)} {sing if g == 1 else plur}")
        elif i == 1:
            textos.append(f"{_centena(g)} mil")
        else:
            textos.append(_centena(g))
    if len(textos) == 1:
        return textos[0]
    # conector "e" antes do último grupo quando ele é < 100 ou centena redonda; senão só espaço
    ultimo = next(g for g in grupos if g)  # grupo menos significativo não nulo
    junta_com_e = ultimo < 100 or ultimo % 100 == 0
    return " ".join(textos[:-1]) + (" e " if junta_com_e else " ") + textos[-1]


def reais_por_extenso(valor: Decimal) -> str:
    if valor < 0:
        raise ValueError("valor negativo")
    if valor != valor.quantize(Decimal("0.01")):
        raise ValueError("mais de 2 casas decimais: arredonde antes (regra do edital)")
    reais = int(valor)
    centavos = int((valor - reais) * 100)
    partes: list[str] = []
    if reais or not centavos:
        txt = inteiro_por_extenso(reais)
        # múltiplo exato de milhão (ou maior) leva "de": "um milhão de reais"
        de = " de" if reais >= 1_000_000 and reais % 1_000_000 == 0 else ""
        partes.append(f"{txt}{de} {'real' if reais == 1 else 'reais'}")
    if centavos:
        partes.append(
            f"{inteiro_por_extenso(centavos)} {'centavo' if centavos == 1 else 'centavos'}"
        )
    return " e ".join(partes)
