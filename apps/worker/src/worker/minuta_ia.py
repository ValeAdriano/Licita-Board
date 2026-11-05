"""Job `minutar_peca` (Fase 10): a IA elabora o RASCUNHO de uma peça jurídica a partir da base jurídica VERIFICADA e do texto do edital.

A IA só sugere: a minuta entra com `minuta_origem = 'ia'`, sem `elaborado_por` (nenhuma pessoa a assumiu) e o fluxo NÃO avança: o
perfil jurídico revisa, edita e envia à revisão/aprovação como em qualquer minuta. Logo depois de gravar, a peça passa pela mesma
validação do módulo (`peca.processar`): citação fora da base verificada bloqueia. Sem chave: status `desligada`.
Nada da empresa (nome, CNPJ, custo, margem) vai ao provedor.
"""

import logging
from datetime import date
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.extracao import Cliente
from worker.llm.extracao_requisitos import ErroLLM
from worker.llm.minuta_peca import (
    SISTEMA,
    VERSAO_PROMPT,
    entrada,
    interpretar,
    montar_usuario,
)
from worker.peca import processar as validar_peca
from worker.rules.citacoes import nao_localizadas

log = logging.getLogger("worker.minuta_ia")


def minutar(
    conn: psycopg.Connection[Any],
    minuta_id: str,
    cliente: Cliente | None,
    hoje: date,
    empresa_job: Any = None,
) -> str | None:
    """Status final, ou None se o pedido não existe/não é da empresa do job (nunca confie no payload, T2)."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select m.id, m.empresa_id, m.peca_id, m.status, m.instrucao, p.tipo, p.titulo, p.status as peca_status, ed.numero_edital, ed.id as edital_id, "
            "g.razao_social as orgao from priv.pecas_ia m join priv.pecas p on p.id = m.peca_id and p.empresa_id = m.empresa_id "
            "join priv.acompanhamentos a on a.id = p.acompanhamento_id join pub.editais ed on ed.id = a.edital_id "
            "join pub.orgaos g on g.id = ed.orgao_id where m.id = %s",
            (minuta_id,),
        )
        m = cur.fetchone()
        if m is None or (empresa_job is not None and str(m["empresa_id"]) != str(empresa_job)):
            return None
        if m["status"] != "pendente":
            return str(m["status"])  # idempotente
        if m["peca_status"] not in ("triagem", "minuta"):
            return _fim(conn, m["id"], "falhou", "a peça já saiu da fase de minuta")
        if cliente is None:
            return _fim(conn, m["id"], "desligada", "IA não configurada para esta empresa")
        cur.execute(
            "select tipo, numero, orgao, dispositivo, titulo, ementa from priv.base_juridica "
            "where empresa_id = %s and deleted_at is null and verificada_em is not null order by tipo, numero, dispositivo limit 80",
            (m["empresa_id"],),
        )
        fontes = cur.fetchall()
        cur.execute(
            "select pagina, texto from pub.trechos where edital_id = %s order by pagina, ordem",
            (m["edital_id"],),
        )
        paginas: dict[int, str] = {}
        for r in cur.fetchall():
            paginas[r["pagina"]] = f"{paginas.get(r['pagina'], '')}\n{r['texto']}"
    if not paginas:
        return _fim(conn, m["id"], "falhou", "o edital ainda não tem texto extraído")
    usuario, truncado = montar_usuario(
        m["tipo"], m["titulo"], m["instrucao"], m["orgao"], m["numero_edital"], paginas, fontes
    )
    try:
        resp = cliente.completar(SISTEMA, usuario)
        saida = interpretar(resp.texto)
    except ErroLLM as e:
        return _fim(conn, m["id"], "falhou", str(e))
    base = [entrada(f) for f in fontes]
    fora = len(nao_localizadas(saida.minuta, base))
    cur_u = conn.execute(
        "update priv.pecas set minuta = %s, clausulas = nullif(btrim(%s), ''), status = 'minuta', minuta_origem = 'ia', minuta_modelo = %s, "
        "validacao = null, validada_em = null, bloqueada = true where id = %s and empresa_id = %s and status in ('triagem', 'minuta')",
        (saida.minuta, saida.clausulas[:2000], resp.modelo, m["peca_id"], m["empresa_id"]),
    )
    if cur_u.rowcount == 0:
        return _fim(conn, m["id"], "falhou", "a peça mudou de fase enquanto a IA minutava")
    conn.execute(
        "update priv.pecas_ia set status = 'concluida', modelo = %s, prompt_versao = %s, tokens_entrada = %s, tokens_saida = %s, referencias_ok = %s, "
        "citacoes_fora_da_base = %s, erro = %s, concluida_em = now() where id = %s",
        (
            resp.modelo,
            VERSAO_PROMPT,
            resp.tokens_entrada,
            resp.tokens_saida,
            len(fontes),
            fora,
            "texto do edital truncado no limite do pedido" if truncado else None,
            m["id"],
        ),
    )
    conn.commit()
    validar_peca(
        conn, str(m["peca_id"]), None, hoje, m["empresa_id"]
    )  # mesma conferência de citações do módulo
    log.info(
        "minuta gerada pela IA",
        extra={"ctx": {"peca": str(m["peca_id"]), "fontes": len(fontes), "fora_da_base": fora}},
    )
    return "concluida"


def _fim(conn: psycopg.Connection[Any], id_: Any, status: str, erro: str) -> str:
    conn.execute(
        "update priv.pecas_ia set status = %s, erro = %s, concluida_em = now() where id = %s",
        (status, erro[:500], id_),
    )
    conn.commit()
    return status
