"""Validação da proposta (Fase 08, 8.6). Código puro: recebe fatos, devolve divergências; nada de I/O nem relógio.

Qualquer divergência BLOQUEANTE impede avançar no fluxo. Avisos aparecem na tela mas não bloqueiam.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

CENTAVOS = Decimal("0.01")


@dataclass(frozen=True)
class ItemProposta:
    numero_item: int
    quantidade: Decimal
    valor_unitario: Decimal
    valor_total: Decimal
    quantidade_edital: Decimal | None  # None = edital sem quantidade informada
    valor_estimado_unit: Decimal | None
    preco_aprovado_unit: (
        Decimal | None
    )  # preço final aprovado AGORA na Fase 07 (None = sem preço aprovado)
    tem_produto: bool
    analise_aprovada: bool  # análise técnica aprovada para o produto ofertado
    marca_modelo: str | None


@dataclass(frozen=True)
class Dados:
    cnpj_valido: bool
    razao_social: str | None
    numero_edital: str | None
    representante_valido: bool
    data_sessao: date | None
    sessao_confirmada: bool
    itens: tuple[ItemProposta, ...]
    total_proposta: Decimal
    documentos_vencidos: tuple[str, ...]  # descrições dos documentos que vencem antes da sessão
    validade_dias: int | None
    prazo_entrega_dias: int | None
    garantia_meses: int | None


@dataclass(frozen=True)
class Divergencia:
    codigo: str
    mensagem: str
    bloqueia: bool


def validar(d: Dados) -> list[Divergencia]:
    out: list[Divergencia] = []

    def bloqueio(codigo: str, msg: str) -> None:
        out.append(Divergencia(codigo, msg, True))

    if not d.cnpj_valido:
        bloqueio("cnpj", "O CNPJ da empresa é inválido.")
    if not d.razao_social:
        bloqueio("razao_social", "A razão social da empresa não está preenchida.")
    if not d.numero_edital:
        bloqueio("numero_edital", "O número do edital não está registrado.")
    if not d.representante_valido:
        bloqueio(
            "representante",
            "O representante não tem poder válido para assinar proposta na data da sessão (procuração vencida, sem o poder ou representante inativo).",
        )
    if d.data_sessao is None:
        bloqueio(
            "sessao",
            "A data da sessão não foi confirmada: os documentos e a procuração não podem ser conferidos.",
        )
    elif not d.sessao_confirmada:
        out.append(
            Divergencia(
                "sessao_provisoria",
                "A data da sessão ainda é provisória (sugerida pelo PNCP).",
                False,
            )
        )
    if not d.itens:
        bloqueio("itens", "A proposta não tem itens.")
    for i in d.itens:
        pre = f"Item {i.numero_item}: "
        if i.preco_aprovado_unit is None:
            bloqueio("preco_sem_aprovacao", pre + "não há preço aprovado (Fase 07).")
        elif i.preco_aprovado_unit != i.valor_unitario:
            bloqueio(
                "preco_mudou",
                pre + "o preço aprovado mudou desde o rascunho: crie uma nova versão.",
            )
        if i.quantidade_edital is not None and i.quantidade != i.quantidade_edital:
            bloqueio(
                "quantidade",
                pre
                + f"a quantidade da proposta ({i.quantidade.normalize():f}) difere da do edital ({i.quantidade_edital.normalize():f}).",
            )
        if (i.quantidade * i.valor_unitario).quantize(
            CENTAVOS, rounding=ROUND_HALF_UP
        ) != i.valor_total:
            bloqueio("total_item", pre + "o total não confere com quantidade × valor unitário.")
        if i.tem_produto and not i.analise_aprovada:
            bloqueio(
                "analise_tecnica", pre + "o produto ofertado não tem análise técnica aprovada."
            )
        if not i.tem_produto:
            bloqueio("produto", pre + "não há produto (marca e modelo) definido.")
        if i.valor_estimado_unit is not None and i.valor_unitario > i.valor_estimado_unit:
            out.append(
                Divergencia(
                    "acima_do_estimado",
                    pre + "o valor unitário está acima do estimado pelo órgão.",
                    False,
                )
            )
    soma = sum((i.valor_total for i in d.itens), Decimal(0))
    if soma != d.total_proposta:
        bloqueio("total", "O total da proposta não é a soma dos totais dos itens.")
    for doc in d.documentos_vencidos:
        bloqueio("documento_vencido", f"Documento de habilitação vence antes da sessão: {doc}.")
    for campo, valor, rotulo in (
        ("validade", d.validade_dias, "a validade da proposta"),
        ("prazo_entrega", d.prazo_entrega_dias, "o prazo de entrega"),
        ("garantia", d.garantia_meses, "a garantia"),
    ):
        if valor is None or valor <= 0:
            bloqueio(campo, f"Informe {rotulo}.")
    return out


def bloqueada(divergencias: list[Divergencia]) -> bool:
    return any(d.bloqueia for d in divergencias)
