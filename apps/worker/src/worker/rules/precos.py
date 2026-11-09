"""Formação de preços (Fase 07, spec §3). Código puro: só `Decimal`, sem I/O, sem relógio, SEM `float` (regra 14).

Preço para uma margem m: custo_direto_unit ÷ (1 − p − m/100), com p = soma dos percentuais sobre o preço (tributos,
comissão, despesas). Parâmetros tributários e percentuais do empate ficto/inexequibilidade vêm de fora: aqui nada é
suposto (🧾 contador, ⚖️ jurídico).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_CEILING, ROUND_DOWN, ROUND_HALF_UP, Decimal

CEM = Decimal(100)
CENTAVOS = Decimal("0.01")


class ErroPreco(ValueError):
    """Entrada que não permite calcular (o job grava a mensagem para a pessoa corrigir)."""


@dataclass(frozen=True)
class Linha:
    """Custo (`por_unidade` ou `total_lote`) ou percentual sobre o preço."""

    tipo: str  # "custo" ou "percentual"
    forma: str | None = None  # "por_unidade" | "total_lote" (só custo)
    valor: Decimal | None = None
    percentual: Decimal | None = None


@dataclass(frozen=True)
class Entrada:
    quantidade: Decimal
    linhas: tuple[Linha, ...]
    margem_desejada_pct: Decimal
    margem_minima_pct: Decimal
    casas: int = 2  # casas do unitário exigidas pelo edital (2 a 6)
    modo: str = "half_up"  # "half_up" arredonda; "truncar" corta
    preco_proposto: Decimal | None = None
    valor_estimado_unit: Decimal | None = None
    limite_inexequivel_pct: Decimal | None = None


@dataclass(frozen=True)
class Resultado:
    custo_direto_unit: Decimal
    percentuais_sobre_preco: Decimal  # em %
    preco_minimo_unit: Decimal
    preco_oferta_unit: Decimal
    preco_final_unit: Decimal
    total_proposta: Decimal
    margem_bruta_pct: Decimal
    margem_liquida_pct: Decimal
    diferenca_estimado_pct: Decimal | None
    abaixo_do_minimo: bool
    risco_inexequivel: str  # "OK" | "RISCO" | "NAO_PARAMETRIZADO"


def _casas(n: int) -> Decimal:
    return Decimal(1).scaleb(-n)


def arredondar(valor: Decimal, casas: int, modo: str) -> Decimal:
    if not 2 <= casas <= 6:
        raise ErroPreco("as casas do unitário devem ficar entre 2 e 6")
    if modo not in ("half_up", "truncar"):
        raise ErroPreco("regra de arredondamento desconhecida")
    return valor.quantize(
        _casas(casas), rounding=ROUND_HALF_UP if modo == "half_up" else ROUND_DOWN
    )


def _preco(custo: Decimal, p: Decimal, margem_pct: Decimal) -> Decimal:
    divisor = Decimal(1) - p / CEM - margem_pct / CEM
    if divisor <= 0:
        raise ErroPreco("os percentuais sobre o preço somados à margem chegam a 100% ou mais")
    return custo / divisor


def calcular(e: Entrada) -> Resultado:
    if e.quantidade <= 0:
        raise ErroPreco("a quantidade deve ser maior que zero")
    for m in (e.margem_desejada_pct, e.margem_minima_pct):
        if m < 0:
            raise ErroPreco("margem não pode ser negativa")
    custo = Decimal(0)
    p = Decimal(0)
    for linha in e.linhas:
        if linha.tipo == "percentual":
            if linha.percentual is None or linha.percentual < 0:
                raise ErroPreco("percentual inválido")
            p += linha.percentual
        elif linha.tipo == "custo":
            if (
                linha.valor is None
                or linha.valor < 0
                or linha.forma not in ("por_unidade", "total_lote")
            ):
                raise ErroPreco("custo inválido")
            custo += linha.valor if linha.forma == "por_unidade" else linha.valor / e.quantidade
        else:
            raise ErroPreco("tipo de linha desconhecido")
    minimo = _preco(custo, p, e.margem_minima_pct).quantize(_casas(e.casas), rounding=ROUND_CEILING)
    oferta = arredondar(_preco(custo, p, e.margem_desejada_pct), e.casas, e.modo)
    final = (
        arredondar(e.preco_proposto, e.casas, e.modo) if e.preco_proposto is not None else oferta
    )
    total = (e.quantidade * final).quantize(CENTAVOS, rounding=ROUND_HALF_UP)
    bruta = ((final - custo) / final * CEM) if final > 0 else Decimal(0)
    liquida = bruta - p
    estimado = e.valor_estimado_unit
    diferenca = ((final - estimado) / estimado * CEM) if estimado else None
    if e.limite_inexequivel_pct is None or not estimado:
        risco = "NAO_PARAMETRIZADO"
    else:
        risco = "RISCO" if final < estimado * e.limite_inexequivel_pct / CEM else "OK"
    q4 = Decimal("0.0001")
    return Resultado(
        custo_direto_unit=custo.quantize(_casas(6), rounding=ROUND_HALF_UP),
        percentuais_sobre_preco=p.quantize(q4),
        preco_minimo_unit=minimo,
        preco_oferta_unit=oferta,
        preco_final_unit=final,
        total_proposta=total,
        margem_bruta_pct=bruta.quantize(q4, rounding=ROUND_HALF_UP),
        margem_liquida_pct=liquida.quantize(q4, rounding=ROUND_HALF_UP),
        diferenca_estimado_pct=None
        if diferenca is None
        else diferenca.quantize(q4, rounding=ROUND_HALF_UP),
        abaixo_do_minimo=final < minimo,
        risco_inexequivel=risco,
    )


def empate_ficto(
    melhor_total: Decimal, proposta_me_epp_total: Decimal, percentual: Decimal
) -> tuple[bool, Decimal]:
    """(há empate ficto, valor limite). ME/EPP até `percentual`% acima da melhor oferta tem direito a nova oferta.

    ⚖️ O percentual (5% no pregão, 10% nas demais modalidades, segundo o Prompt Mestre) é parâmetro: confirmar com o jurídico.
    Não há empate se a proposta da ME/EPP já é a melhor (menor ou igual).
    """
    if melhor_total <= 0 or percentual < 0:
        raise ErroPreco("valores inválidos para o empate ficto")
    limite = (melhor_total * (CEM + percentual) / CEM).quantize(CENTAVOS, rounding=ROUND_DOWN)
    return melhor_total < proposta_me_epp_total <= limite, limite


@dataclass(frozen=True)
class EstatisticaHistorico:
    """Estatística descritiva sobre preços vencedores históricos da mesma unidade (spec 07 §8.4)."""

    n: int
    minimo: Decimal
    mediana: Decimal
    maximo: Decimal
    unidade: str
    diferenca_nosso_pct: Decimal | None = None


def estatistica_historico(
    amostra: Sequence[tuple[Decimal | None, str | None]],
    nosso_preco_unit: Decimal | None = None,
) -> EstatisticaHistorico | None:
    """Calcula n, mínimo, mediana (`percentile_disc(0.5)`) e máximo em Decimal sem interpolação.

    Devolve `None` se não houver valores válidos ou se houver unidades distintas (RF-07.13).
    """
    validos: list[tuple[Decimal, str]] = []
    for valor, unidade in amostra:
        if valor is None or valor < 0:
            continue
        un = (unidade or "").strip().upper() or "UN"
        validos.append((valor.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP), un))
    if not validos:
        return None
    unidades = {u for _, u in validos}
    if len(unidades) > 1:
        return None
    unidade_unica = next(iter(unidades))
    valores = sorted(v for v, _ in validos)
    n = len(valores)
    mediana = valores[(n - 1) // 2]
    dif: Decimal | None = None
    if nosso_preco_unit is not None and mediana > 0:
        dif = ((nosso_preco_unit - mediana) / mediana * CEM).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP
        )
    return EstatisticaHistorico(
        n=n,
        minimo=valores[0],
        mediana=mediana,
        maximo=valores[-1],
        unidade=unidade_unica,
        diferenca_nosso_pct=dif,
    )
