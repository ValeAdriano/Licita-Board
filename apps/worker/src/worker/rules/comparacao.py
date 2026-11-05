"""Comparação de requisito x produto e classificação da análise técnica (Fase 06, spec §3). Código puro.

A IA nunca decide: aqui só há aritmética com `Decimal`, unidades normalizadas pela tabela `pub.unidades` (fator e
deslocamento) e regras de classificação. Sem evidência verificada nunca há `ATENDE` (regra 15 do AGENTS.md).
"""

import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum


class Resultado(StrEnum):
    ATENDE = "ATENDE"
    RESSALVAS = "ATENDE COM RESSALVAS"
    A_CONFIRMAR = "A CONFIRMAR"
    NAO_ATENDE = "NÃO ATENDE"


@dataclass(frozen=True)
class Unidade:
    simbolo: str
    grandeza: str
    fator: Decimal
    deslocamento: Decimal = Decimal(0)


@dataclass(frozen=True)
class Valor:
    numero: Decimal | None = None
    texto: str | None = None
    booleano: bool | None = None
    unidade: Unidade | None = None


NUMERICOS = frozenset({">=", "<=", "=", "entre"})
OPERADORES = NUMERICOS | {"contem", "sim", "nao"}


@dataclass(frozen=True)
class Requisito:
    operador: str
    valor: Valor | None = None
    valor_max: Valor | None = None  # só para "entre"
    obrigatorio: bool = True


@dataclass(frozen=True)
class Classificacao:
    resultado: Resultado
    pendencia: str | None
    justificativa: str


def para_base(numero: Decimal, unidade: Unidade | None) -> Decimal:
    """Valor na unidade base da grandeza (base = fator 1 e deslocamento 0)."""
    return numero if unidade is None else numero * unidade.fator + unidade.deslocamento


def _sem_acento(t: str) -> str:
    return (
        "".join(c for c in unicodedata.normalize("NFKD", t) if not unicodedata.combining(c))
        .lower()
        .strip()
    )


def _numerico(req: Requisito, oferta: Valor) -> tuple[bool | None, str | None]:
    if req.valor is None or req.valor.numero is None:
        return None, "o requisito não tem valor numérico"
    if oferta.numero is None:
        return None, "o produto não tem esse valor cadastrado"
    pontas = [req.valor, *([req.valor_max] if req.operador == "entre" else [])]
    if req.operador == "entre" and (req.valor_max is None or req.valor_max.numero is None):
        return None, "faixa sem limite superior"
    unidades = {p.unidade.grandeza if p.unidade else None for p in pontas if p} | {
        oferta.unidade.grandeza if oferta.unidade else None
    }
    if len(unidades) > 1:
        return None, "unidade ausente ou de grandeza diferente entre o edital e o produto"
    o = para_base(oferta.numero, oferta.unidade)
    minimo = para_base(req.valor.numero, req.valor.unidade)
    if req.operador == ">=":
        return o >= minimo, None
    if req.operador == "<=":
        return o <= minimo, None
    if req.operador == "=":
        return o == minimo, None
    assert req.valor_max is not None and req.valor_max.numero is not None  # noqa: S101 - garantido acima
    return minimo <= o <= para_base(req.valor_max.numero, req.valor_max.unidade), None


def comparar(req: Requisito, oferta: Valor | None) -> tuple[bool | None, str | None]:
    """(cumpre, motivo): True/False quando dá para decidir; None (com motivo) quando falta informação."""
    if req.operador not in OPERADORES:
        return None, "operador desconhecido"
    if oferta is None:
        return None, "o produto não tem esse atributo cadastrado"
    if req.operador in NUMERICOS:
        return _numerico(req, oferta)
    if req.operador in ("sim", "nao"):
        if oferta.booleano is None:
            return None, "o produto não informa sim/não para esse atributo"
        return oferta.booleano is (req.operador == "sim"), None
    if not req.valor or not req.valor.texto or not oferta.texto:
        return None, "falta o texto do requisito ou do produto"
    return _sem_acento(req.valor.texto) in _sem_acento(oferta.texto), None


def classificar(
    req: Requisito,
    oferta: Valor | None,
    *,
    citacao_edital_ok: bool,
    ficha_conferida: bool,
    ressalva: str | None = None,
) -> Classificacao:
    cumpre, motivo = comparar(req, oferta)
    if cumpre is False:
        return Classificacao(
            Resultado.NAO_ATENDE,
            None,
            "O valor do produto não satisfaz o requisito (comparado por código, com unidades normalizadas).",
        )
    if cumpre is None:
        return Classificacao(
            Resultado.A_CONFIRMAR, f"Falta informação: {motivo}.", "Não foi possível comparar."
        )
    if not citacao_edital_ok:
        return Classificacao(
            Resultado.A_CONFIRMAR,
            "A citação do edital não foi encontrada no texto do edital: confira o trecho e a página.",
            "A comparação é satisfeita, mas a evidência do edital não foi verificada.",
        )
    if not ficha_conferida:
        return Classificacao(
            Resultado.A_CONFIRMAR,
            "Falta conferir a evidência na ficha técnica oficial (documento, página e trecho).",
            "A comparação é satisfeita, mas a evidência da ficha técnica não foi conferida por uma pessoa.",
        )
    if ressalva:
        return Classificacao(
            Resultado.RESSALVAS, f"Ressalva: {ressalva}", "Atende com a ressalva registrada."
        )
    return Classificacao(
        Resultado.ATENDE,
        None,
        "Atende, com evidência do edital verificada e ficha técnica conferida.",
    )


def resumo(linhas: list[tuple[bool, Resultado]]) -> str:
    """Resumo do item: `(obrigatorio, resultado)` por requisito. Obrigatório não atendido nunca dá atendimento integral."""
    obrigatorios = [r for ob, r in linhas if ob]
    if not obrigatorios:
        return "PENDENTE"
    if Resultado.NAO_ATENDE in obrigatorios:
        return "REPROVADO"
    if Resultado.A_CONFIRMAR in obrigatorios:
        return "PENDENTE"
    return "COMPATÍVEL COM RESSALVAS" if Resultado.RESSALVAS in obrigatorios else "COMPATÍVEL"
