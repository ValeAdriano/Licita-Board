"""Job `gerar_proposta` (Fase 08): valida a proposta (8.6) e, estando APROVADA e sem divergência bloqueante, gera o documento final.

Quem valida e gera é código (rules/proposta.py, rules/extenso.py, docx.py); este módulo lê o banco, chama e grava. Idempotente.
- Sempre: grava a validação e o valor por extenso.
- Aprovada + sem bloqueio: gera o .docx, grava no armazenamento, calcula o SHA-256 e marca `final` (imutável).
- Aprovada + com bloqueio (algo mudou desde a aprovação): volta a rascunho, sem aprovação.
O sistema NUNCA envia ao portal (regra 17): a pessoa autorizada baixa o arquivo e registra o comprovante.
"""

import hashlib
import json
import logging
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Protocol

import psycopg
from psycopg.rows import dict_row

from worker.agenda_documentos import _documentos
from worker.docx import montar, paragrafo, tabela
from worker.rules.alertas import FUSO
from worker.rules.extenso import reais_por_extenso
from worker.rules.proposta import Dados, ItemProposta, bloqueada, validar
from worker.rules.vencimentos import vencem_antes

log = logging.getLogger("worker.proposta")
MESES = (
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
)


class Gravador(Protocol):
    def gravar(self, chave: str, dados: bytes) -> None: ...


def reais(v: Decimal, casas: int = 2) -> str:
    q = v.quantize(Decimal(1).scaleb(-casas), rounding=ROUND_HALF_UP)
    inteiro, _, frac = f"{q:.{casas}f}".partition(".")
    milhar = f"{int(inteiro):,}".replace(",", ".")
    return f"R$ {milhar},{frac}" if casas else f"R$ {milhar}"


def _itens(
    conn: psycopg.Connection[Any], p: dict[str, Any]
) -> tuple[list[dict[str, Any]], tuple[ItemProposta, ...]]:
    snapshot: list[dict[str, Any]] = p["conteudo"]
    saida: list[ItemProposta] = []
    with conn.cursor(row_factory=dict_row) as cur:
        for it in snapshot:
            cur.execute(
                "select i.quantidade, i.valor_unitario_estimado from priv.participacoes pa left join pub.edital_itens i on i.id = pa.item_id "
                "where pa.id = %s and pa.empresa_id = %s",
                (it["participacao_id"], p["empresa_id"]),
            )
            ed = cur.fetchone() or {}
            cur.execute(
                "select preco_final_unit from priv.precificacoes where participacao_id = %s and empresa_id = %s and deleted_at is null "
                "and aprovado_em is not null and erro_calculo is null order by created_at limit 1",
                (it["participacao_id"], p["empresa_id"]),
            )
            pr = cur.fetchone()
            aprovada = False
            if it.get("produto_id"):
                cur.execute(
                    "select 1 from priv.analises_item where participacao_id = %s and produto_id = %s and empresa_id = %s and aprovado_em is not null "
                    "and aprovado_resumo in ('COMPATÍVEL', 'COMPATÍVEL COM RESSALVAS')",
                    (it["participacao_id"], it["produto_id"], p["empresa_id"]),
                )
                aprovada = cur.fetchone() is not None
            saida.append(
                ItemProposta(
                    numero_item=int(it.get("numero_item") or 0), quantidade=Decimal(it["quantidade"]), valor_unitario=Decimal(it["valor_unitario"]),
                    valor_total=Decimal(it["valor_total"]).quantize(Decimal("0.01")),
                    quantidade_edital=Decimal(ed["quantidade"]) if ed.get("quantidade") is not None else None,
                    valor_estimado_unit=Decimal(ed["valor_unitario_estimado"]) if ed.get("valor_unitario_estimado") is not None else None,
                    preco_aprovado_unit=Decimal(pr["preco_final_unit"]) if pr else None, tem_produto=bool(it.get("produto_id")),
                    analise_aprovada=aprovada, marca_modelo=" ".join(x for x in (it.get("marca"), it.get("modelo")) if x) or None,
                )
            )  # fmt: skip
    return snapshot, tuple(saida)


def _documento(
    p: dict[str, Any], ctx: dict[str, Any], snapshot: list[dict[str, Any]], extenso: str, hoje: date
) -> bytes:
    linhas = [
        [str(i.get("numero_item", "")), str(i.get("descricao") or ""), " ".join(x for x in (i.get("marca"), i.get("modelo")) if x), Decimal(i["quantidade"]).normalize().__format__("f"),
         reais(Decimal(i["valor_unitario"]), int(i.get("casas") or 2)), reais(Decimal(i["valor_total"]))]
        for i in snapshot
    ]  # fmt: skip
    corpo = [
        paragrafo("PROPOSTA COMERCIAL", negrito=True, tamanho=16, centro=True),
        paragrafo(f"Versão {p['versao']}", centro=True),
        paragrafo(f"{ctx['razao_social']} · CNPJ {ctx['cnpj']}", negrito=True),
        paragrafo(f"Ao {ctx['orgao']}"),
        paragrafo(f"Edital nº {ctx['numero_edital']}"),
        paragrafo("Prezados Senhores, apresentamos nossa proposta para o fornecimento dos itens abaixo:"),
        tabela(["Item", "Descrição", "Marca / Modelo", "Quantidade", "Valor unitário", "Valor total"], linhas),
        paragrafo(f"Valor total da proposta: {reais(Decimal(p['total']))} ({extenso})", negrito=True),
        paragrafo(f"Validade da proposta: {p['validade_dias']} dias. Prazo de entrega: {p['prazo_entrega_dias']} dias. Garantia: {p['garantia_meses']} meses."),
    ]  # fmt: skip
    if p["condicoes"]:
        corpo.append(paragrafo(f"Condições comerciais: {p['condicoes']}"))
    local = p["local_assinatura"] or ""
    corpo += [
        paragrafo(
            f"{local + ', ' if local else ''}{hoje.day} de {MESES[hoje.month - 1]} de {hoje.year}."
        ),
        paragrafo("______________________________"),
        paragrafo(f"{ctx['rep_nome'] or ''}{' · ' + ctx['rep_cargo'] if ctx['rep_cargo'] else ''}"),
    ]
    return montar(corpo)


def gerar_proposta(
    conn: psycopg.Connection[Any],
    proposta_id: str,
    s3: Gravador | None,
    hoje: date,
    empresa_job: Any = None,
) -> str | None:
    """Devolve o status final ('rascunho', 'conferencia', 'aprovada', 'final') ou None se não existe/não é da empresa do job."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select p.*, e.razao_social, e.cnpj::text as cnpj, a.data_abertura, a.abertura_confirmada, a.id as acomp, ed.numero_edital, g.razao_social as orgao, "
            "r.nome as rep_nome, r.cargo as rep_cargo from priv.propostas p join core.empresas e on e.id = p.empresa_id "
            "join priv.acompanhamentos a on a.id = p.acompanhamento_id join pub.editais ed on ed.id = a.edital_id join pub.orgaos g on g.id = ed.orgao_id "
            "left join core.representantes r on r.id = p.representante_id where p.id = %s and p.deleted_at is null",
            (proposta_id,),
        )
        p = cur.fetchone()
        if p is None or (empresa_job is not None and str(p["empresa_id"]) != str(empresa_job)):
            return None  # nunca confie no payload (T2)
        if p["status"] == "final":
            return "final"  # imutável: nada a fazer
        cnpj_ok = bool(conn.execute("select core.cnpj_valido(%s)", (p["cnpj"],)).fetchone()[0])  # type: ignore[index]
        dia_sessao = p["data_abertura"].astimezone(FUSO).date() if p["data_abertura"] else None
        rep_ok = bool(p["representante_id"]) and bool(
            conn.execute(
                "select core.signatario_valido(%s, %s, 'assinar_proposta')",
                (p["representante_id"], dia_sessao or hoje),
            ).fetchone()[0]  # type: ignore[index]
        )
    snapshot, itens = _itens(conn, p)
    vencidos = (
        tuple(d.descricao for d in vencem_antes(_documentos(conn, p["empresa_id"]), dia_sessao))
        if dia_sessao
        else ()
    )
    total = Decimal(p["total"])
    divergencias = validar(
        Dados(
            cnpj_valido=cnpj_ok, razao_social=p["razao_social"], numero_edital=p["numero_edital"], representante_valido=rep_ok, data_sessao=dia_sessao,
            sessao_confirmada=bool(p["abertura_confirmada"]), itens=itens, total_proposta=total, documentos_vencidos=vencidos, validade_dias=p["validade_dias"],
            prazo_entrega_dias=p["prazo_entrega_dias"], garantia_meses=p["garantia_meses"],
        )
    )  # fmt: skip
    bloq = bloqueada(divergencias)
    extenso = reais_por_extenso(total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    valid_json = json.dumps(
        [{"codigo": d.codigo, "mensagem": d.mensagem, "bloqueia": d.bloqueia} for d in divergencias]
    )
    status = p["status"]
    if status == "aprovada" and bloq:
        conn.execute(
            "update priv.propostas set status = 'rascunho', aprovado_por = null, aprovado_em = null, conferido_por = null, conferido_em = null, "
            "validacao = %s::jsonb, validada_em = now(), bloqueada = true, total_extenso = %s where id = %s",
            (valid_json, extenso, p["id"]),
        )
        conn.commit()
        log.info(
            "proposta aprovada voltou a rascunho por divergência",
            extra={"ctx": {"proposta": str(p["id"])}},
        )
        return "rascunho"
    if status == "aprovada":
        if s3 is None:
            raise RuntimeError("armazenamento não configurado")
        arquivo = _documento(p, p, snapshot, extenso, hoje)
        chave = f"propostas/{p['empresa_id']}/{p['acomp']}/proposta-v{p['versao']}.docx"
        s3.gravar(chave, arquivo)
        conn.execute(
            "update priv.propostas set status = 'final', arquivo_chave = %s, arquivo_sha256 = %s, gerado_em = now(), validacao = %s::jsonb, validada_em = now(), "
            "bloqueada = false, total_extenso = %s where id = %s",
            (chave, hashlib.sha256(arquivo).hexdigest(), valid_json, extenso, p["id"]),
        )
        conn.commit()
        log.info(
            "proposta final gerada",
            extra={"ctx": {"proposta": str(p["id"]), "versao": p["versao"]}},
        )
        return "final"
    conn.execute(
        "update priv.propostas set validacao = %s::jsonb, validada_em = now(), bloqueada = %s, total_extenso = %s where id = %s",
        (valid_json, bloq, extenso, p["id"]),
    )
    conn.commit()
    return str(status)


def hoje_local(agora: datetime) -> date:
    return agora.astimezone(FUSO).date()
