"""Job `processar_peca` (Fase 10): confere as citações da minuta contra a base jurídica VERIFICADA e, com a peça aprovada, gera o documento final.

Quem confere é código puro (rules/citacoes.py). Citação de lei, acórdão ou súmula fora da base verificada BLOQUEIA: a minuta não vai à revisão e,
se já estava aprovada, volta a minuta. Sem aprovação com `aprovar_peca` (feita por pessoa) não há documento final. O sistema NUNCA protocola.
O documento final (Word e PDF) recebe SHA-256 e fica imutável; protocolo e resultado são registros humanos feitos depois.
"""

import hashlib
import json
import logging
from datetime import date
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.docx import montar, paragrafo
from worker.pdf import PdfIndisponivel, docx_para_pdf
from worker.proposta import MESES, Gravador
from worker.rules.citacoes import Entrada, nao_localizadas

log = logging.getLogger("worker.peca")
TITULO = {
    "esclarecimento": "PEDIDO DE ESCLARECIMENTO",
    "impugnacao": "IMPUGNAÇÃO AO EDITAL",
    "recurso": "RECURSO ADMINISTRATIVO",
    "contrarrazoes": "CONTRARRAZÕES DE RECURSO",
    "reajuste": "PEDIDO DE REAJUSTE CONTRATUAL",
    "reequilibrio": "PEDIDO DE REEQUILÍBRIO ECONÔMICO-FINANCEIRO",
}


def _base(conn: psycopg.Connection[Any], empresa: Any) -> list[Entrada]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select tipo, numero, orgao, dispositivo from priv.base_juridica where empresa_id = %s and deleted_at is null and verificada_em is not null",
            (empresa,),
        )
        return [
            Entrada(r["tipo"], r["numero"], r["orgao"], r["dispositivo"]) for r in cur.fetchall()
        ]


def validar(p: dict[str, Any], base: list[Entrada], riscos: int = 0) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    texto = (p["minuta"] or "").strip()
    if len(texto) < 30:
        out.append(
            {
                "codigo": "minuta_vazia",
                "mensagem": "A minuta está vazia ou curta demais.",
                "bloqueia": True,
            }
        )
    if not (p["clausulas"] or "").strip():
        out.append(
            {
                "codigo": "sem_clausulas",
                "mensagem": "Informe as cláusulas, documentos e páginas do edital que sustentam cada argumento (10.1).",
                "bloqueia": True,
            }
        )
    for c in nao_localizadas(texto, base):
        out.append(
            {
                "codigo": "citacao_fora_da_base",
                "mensagem": f"Citação fora da base jurídica verificada: “{c.trecho}”. Cadastre e verifique a fonte oficial ou retire a citação.",
                "bloqueia": True,
            }
        )
    if riscos:
        out.append(
            {
                "codigo": "ponto_de_risco",
                "mensagem": f"{riscos} alegação(ões) do recurso a rebater sem prova que a refute: ponto de risco para o jurídico (indique a prova e o fundamento na tela do recurso).",
                "bloqueia": False,
            }
        )
    if not base:
        out.append(
            {
                "codigo": "base_vazia",
                "mensagem": "A base jurídica verificada da empresa está vazia: nenhuma citação legal é aceita.",
                "bloqueia": False,
            }
        )
    return out


def _documento(p: dict[str, Any], ctx: dict[str, Any], hoje: date) -> bytes:
    corpo = [
        paragrafo(TITULO[p["tipo"]], negrito=True, tamanho=16, centro=True),
        paragrafo(p["titulo"], centro=True),
        paragrafo(f"Ao {ctx['orgao']} · Edital nº {ctx['numero_edital'] or ''}", negrito=True),
        paragrafo(f"{ctx['razao_social']} · CNPJ {ctx['cnpj']}"),
    ]
    corpo += [paragrafo(par.strip()) for par in (p["minuta"] or "").split("\n\n") if par.strip()]
    corpo += [
        paragrafo(f"Referências ao edital: {p['clausulas']}"),
        paragrafo(f"{hoje.day} de {MESES[hoje.month - 1]} de {hoje.year}."),
        paragrafo("______________________________"),
        paragrafo(f"{ctx['aprovador'] or ''}{' · OAB ' + ctx['oab'] if ctx['oab'] else ''}"),
    ]
    return montar(corpo)


def _pdf(conn: psycopg.Connection[Any], p: dict[str, Any], docx: bytes, s3: Gravador) -> None:
    try:
        pdf = docx_para_pdf(docx)
    except PdfIndisponivel as e:
        log.warning("peça sem PDF: %s", e)
        return
    chave = p["arquivo_chave"][: -len(".docx")] + ".pdf"
    s3.gravar(chave, pdf)
    conn.execute(
        "update priv.pecas set arquivo_pdf_chave = %s, arquivo_pdf_sha256 = %s where id = %s",
        (chave, hashlib.sha256(pdf).hexdigest(), p["id"]),
    )
    conn.commit()


def processar(
    conn: psycopg.Connection[Any],
    peca_id: str,
    s3: Gravador | None,
    hoje: date,
    empresa_job: Any = None,
) -> str | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select p.*, e.razao_social, e.cnpj::text as cnpj, ed.numero_edital, g.razao_social as orgao, u.nome as aprovador, u.oab from priv.pecas p "
            "join core.empresas e on e.id = p.empresa_id join priv.acompanhamentos a on a.id = p.acompanhamento_id join pub.editais ed on ed.id = a.edital_id "
            "join pub.orgaos g on g.id = ed.orgao_id left join core.usuarios u on u.id = p.aprovado_por where p.id = %s",
            (peca_id,),
        )
        p = cur.fetchone()
    if p is None or (empresa_job is not None and str(p["empresa_id"]) != str(empresa_job)):
        return None  # nunca confie no payload (T2)
    if p["status"] in ("final", "protocolada", "respondida"):
        if p["arquivo_pdf_chave"] is None and s3 is not None:
            _pdf(conn, p, s3.ler(p["arquivo_chave"]), s3)  # só falta o PDF: o resto é imutável
        return str(p["status"])
    if p["status"] not in ("triagem", "minuta", "revisao", "aprovada"):
        return str(p["status"])
    riscos = conn.execute(
        "select count(*) from priv.recurso_alegacoes a join priv.recursos_terceiros r on r.id = a.recurso_id and r.empresa_id = a.empresa_id "
        "where r.peca_id = %s and a.empresa_id = %s and a.risco",
        (p["id"], p["empresa_id"]),
    ).fetchone()
    divergencias = validar(p, _base(conn, p["empresa_id"]), int(riscos[0]) if riscos else 0)
    bloq = any(d["bloqueia"] for d in divergencias)
    valid = json.dumps(divergencias)
    if p["status"] in ("revisao", "aprovada") and bloq:
        conn.execute(
            "update priv.pecas set status = 'minuta', revisado_por = null, revisado_em = null, aprovado_por = null, aprovado_em = null, validacao = %s::jsonb, "
            "validada_em = now(), bloqueada = true where id = %s",
            (valid, p["id"]),
        )
        conn.commit()
        return "minuta"
    if p["status"] == "aprovada":
        if s3 is None:
            raise RuntimeError("armazenamento não configurado")
        arquivo = _documento(p, p, hoje)
        chave = f"pecas/{p['empresa_id']}/{p['acompanhamento_id']}/{p['id']}.docx"
        s3.gravar(chave, arquivo)
        conn.execute(
            "update priv.pecas set status = 'final', arquivo_chave = %s, arquivo_sha256 = %s, gerado_em = now(), validacao = %s::jsonb, validada_em = now(), bloqueada = false where id = %s",
            (chave, hashlib.sha256(arquivo).hexdigest(), valid, p["id"]),
        )
        conn.commit()
        _pdf(conn, {**p, "arquivo_chave": chave}, arquivo, s3)
        log.info("peça final gerada", extra={"ctx": {"peca": str(p["id"]), "tipo": p["tipo"]}})
        return "final"
    conn.execute(
        "update priv.pecas set validacao = %s::jsonb, validada_em = now(), bloqueada = %s where id = %s",
        (valid, bloq, p["id"]),
    )
    conn.commit()
    return str(p["status"])
