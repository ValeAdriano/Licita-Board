"""Relevância de um item de edital para uma empresa (Fase 04, RF-04.8 e RF-04.14).

Código puro e determinístico: sem I/O, sem IA, sem relógio. Nota 0-100 a partir dos termos
cadastrados (palavra, sinônimo, categoria, marca, modelo, relacionado) no item, no objeto e nos
trechos dos arquivos; termos de exclusão reduzem; filtros não atendidos NÃO descartam, só rebaixam a
faixa e ficam registrados. Nota baixa vira faixa "baixa" (Baixa relevância), nunca some. Pesos e
limiares são <A DEFINIR>: valores iniciais, a calibrar com editais reais classificados pela operação
(spec fase-04, pergunta 12).
"""

import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal

VERSAO_REGRA = "rel-v0"

# <A DEFINIR>: pesos iniciais.
PESO_TIPO = {
    "palavra": 30,
    "sinonimo": 25,
    "categoria": 15,
    "marca": 20,
    "modelo": 25,
    "relacionado": 10,
}
PESO_LOCAL = {"item": Decimal("1.0"), "objeto": Decimal("0.6"), "trecho": Decimal("0.4")}
PENA_EXCLUSAO = {"item": 40, "objeto": 40, "trecho": 15}
SEMELHANCA_MIN = Decimal("0.5")
SEMELHANCA_TETO = 30
LIMIAR_ALTA = 60
LIMIAR_MEDIA = 30
_ORDEM = ("baixa", "media", "alta")


def normalizar(texto: str) -> str:
    """Minúsculas, sem acento e com espaços simples, para comparar termo e texto."""
    sem = unicodedata.normalize("NFKD", texto)
    sem = "".join(c for c in sem if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", sem.lower()).strip()


def _contem(texto_norm: str, termo_norm: str) -> bool:
    """Palavra inteira (ou expressão inteira): 'cadeira' não casa dentro de 'cadeirante'."""
    return (
        bool(termo_norm)
        and re.search(rf"(?<![a-z0-9]){re.escape(termo_norm)}(?![a-z0-9])", texto_norm) is not None
    )


@dataclass(frozen=True)
class Termo:
    tipo: str  # palavra | sinonimo | categoria | marca | modelo | relacionado | exclusao
    texto: str


@dataclass(frozen=True)
class Filtros:
    ufs: tuple[str, ...] = ()
    municipios: tuple[tuple[str, str], ...] = ()  # (uf, município)
    valor_min: Decimal | None = None
    valor_max: Decimal | None = None
    restricoes: tuple[str, ...] = ()


@dataclass(frozen=True)
class TrechoRef:
    arquivo_id: str
    pagina: int
    texto: str


@dataclass(frozen=True)
class ItemEntrada:
    descricao: str
    objeto: str
    uf: str | None
    municipio: str | None
    valor: Decimal | None  # total estimado do item, ou do edital se o item não informar
    trechos: tuple[TrechoRef, ...] = ()


@dataclass
class Avaliacao:
    nota: int
    faixa: str
    motivos: list[dict[str, object]] = field(default_factory=list)
    fora_dos_filtros: list[dict[str, object]] = field(default_factory=list)


def faixa_da_nota(nota: int) -> str:
    return "alta" if nota >= LIMIAR_ALTA else "media" if nota >= LIMIAR_MEDIA else "baixa"


def avaliar(
    item: ItemEntrada,
    termos: list[Termo],
    filtros: Filtros,
    semelhanca: Decimal | None = None,
) -> Avaliacao:
    desc, obj = normalizar(item.descricao), normalizar(item.objeto)
    trechos = [(t, normalizar(t.texto)) for t in item.trechos]
    soma = Decimal(0)
    pena = 0
    motivos: list[dict[str, object]] = []
    vistos: set[tuple[str, str]] = set()
    for t in termos:
        termo = normalizar(t.texto)
        if (t.tipo, termo) in vistos or not termo:
            continue
        vistos.add((t.tipo, termo))
        achou: dict[str, object] | None = None
        if _contem(desc, termo):
            achou = {"onde": "item"}
        elif _contem(obj, termo):
            achou = {"onde": "objeto"}
        else:
            for ref, norm in trechos:
                if _contem(norm, termo):
                    achou = {"onde": "trecho", "arquivo_id": ref.arquivo_id, "pagina": ref.pagina}
                    break
        if achou is None:
            continue
        motivos.append({"tipo": t.tipo, "termo": t.texto, **achou})
        onde = str(achou["onde"])
        if t.tipo == "exclusao":
            pena += PENA_EXCLUSAO[onde]
        else:
            soma += PESO_TIPO[t.tipo] * PESO_LOCAL[onde]
    nota = int(soma.to_integral_value()) if soma else 0
    if semelhanca is not None and semelhanca > SEMELHANCA_MIN:
        bonus = min(SEMELHANCA_TETO, int((semelhanca - SEMELHANCA_MIN) * 100))
        nota += bonus
        motivos.append({"tipo": "semantica", "semelhanca": str(semelhanca)})
    nota = max(0, min(100, nota - pena))
    fora = _fora_dos_filtros(item, filtros, desc, obj)
    faixa = faixa_da_nota(nota)
    if fora:  # filtro não atendido rebaixa uma faixa; nunca descarta
        faixa = _ORDEM[max(0, _ORDEM.index(faixa) - 1)]
    return Avaliacao(nota, faixa, motivos, fora)


def _fora_dos_filtros(
    item: ItemEntrada, f: Filtros, desc: str, obj: str
) -> list[dict[str, object]]:
    fora: list[dict[str, object]] = []
    if f.ufs and (item.uf or "") not in f.ufs:
        fora.append({"filtro": "uf", "valor": item.uf})
    if f.municipios and (item.uf, normalizar(item.municipio or "")) not in {
        (uf, normalizar(m)) for uf, m in f.municipios
    }:
        fora.append({"filtro": "municipio", "valor": item.municipio})
    if item.valor is not None:
        if f.valor_min is not None and item.valor < f.valor_min:
            fora.append({"filtro": "valor_min", "valor": str(item.valor)})
        if f.valor_max is not None and item.valor > f.valor_max:
            fora.append({"filtro": "valor_max", "valor": str(item.valor)})
    for r in f.restricoes:
        rn = normalizar(r)
        if _contem(desc, rn) or _contem(obj, rn):
            fora.append({"filtro": "restricao", "valor": r})
    return fora
