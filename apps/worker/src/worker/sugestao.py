"""Job `sugerir_pecas` (Fase 10, 10.2/10.3): a IA sugere pedidos de esclarecimento e impugnações a partir do texto do edital.

A IA só SUGERE. O código confere o trecho literal no edital (sem ele a sugestão não entra), descarta fundamento fora da base jurídica verificada,
limita a viabilidade da impugnação sem fundamento verificado e marca como INTEMPESTIVA o que já passou do prazo legal da agenda (não é
sugerido como pedido). Repetir a busca troca as sugestões 'novas' e não repete as já decididas. Sem chave: `desligada`.
"""

import logging
from datetime import datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.extracao import Cliente
from worker.llm.extracao_requisitos import ErroLLM
from worker.llm.minuta_peca import referencia
from worker.llm.sugestao_pecas import SISTEMA, VERSAO_PROMPT, interpretar, montar_usuario
from worker.rules.citacoes import Entrada
from worker.rules.evidencia import normalizar, pagina_da_citacao
from worker.rules.sugestao import ajustar_viabilidade, fundamento_verificado, tempestiva

log = logging.getLogger("worker.sugestao")


def sugerir(
    conn: psycopg.Connection[Any],
    execucao_id: str,
    cliente: Cliente | None,
    agora: datetime,
    empresa_job: Any = None,
) -> str | None:
    """Status final, ou None se o pedido não existe/não é da empresa do job (nunca confie no payload, T2)."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select x.id, x.empresa_id, x.acompanhamento_id, x.status, a.edital_id from priv.sugestoes_execucoes x "
            "join priv.acompanhamentos a on a.id = x.acompanhamento_id where x.id = %s",
            (execucao_id,),
        )
        x = cur.fetchone()
        if x is None or (empresa_job is not None and str(x["empresa_id"]) != str(empresa_job)):
            return None
        if x["status"] != "pendente":
            return str(x["status"])  # idempotente
        if cliente is None:
            return _terminar(conn, x["id"], "desligada", "IA não configurada para esta empresa")
        cur.execute(
            "select tipo, numero, orgao, dispositivo, titulo from priv.base_juridica where empresa_id = %s and deleted_at is null and verificada_em is not null "
            "order by tipo, numero, dispositivo limit 80",
            (x["empresa_id"],),
        )
        fontes = cur.fetchall()
        cur.execute(
            "select pagina, texto from pub.trechos where edital_id = %s order by pagina, ordem",
            (x["edital_id"],),
        )
        paginas: dict[int, str] = {}
        for r in cur.fetchall():
            paginas[r["pagina"]] = f"{paginas.get(r['pagina'], '')}\n{r['texto']}"
        cur.execute(
            "select tipo, data_limite_legal from priv.agenda_eventos where acompanhamento_id = %s and empresa_id = %s and tipo in ('esclarecimento', 'impugnacao')",
            (x["acompanhamento_id"], x["empresa_id"]),
        )
        limites = {r["tipo"]: r["data_limite_legal"] for r in cur.fetchall()}
        cur.execute(
            "select trecho_edital from priv.sugestoes_pecas where acompanhamento_id = %s and empresa_id = %s and status in ('aceita', 'descartada')",
            (x["acompanhamento_id"], x["empresa_id"]),
        )
        ja_decididas = {normalizar(r["trecho_edital"] or "") for r in cur.fetchall()}
    if not paginas:
        return _terminar(conn, x["id"], "falhou", "o edital ainda não tem texto extraído")
    base = [Entrada(f["tipo"], f["numero"], f["orgao"], f["dispositivo"]) for f in fontes]
    usuario, truncado = montar_usuario(paginas, [referencia(f) for f in fontes])
    try:
        resp = cliente.completar(SISTEMA, usuario)
        sugestoes, descartadas = interpretar(resp.texto)
    except ErroLLM as e:
        return _terminar(conn, x["id"], "falhou", str(e))
    conn.execute(
        "delete from priv.sugestoes_pecas where acompanhamento_id = %s and empresa_id = %s and status in ('nova', 'intempestiva')",
        (x["acompanhamento_id"], x["empresa_id"]),
    )
    criadas = 0
    for s in sugestoes:
        pagina = pagina_da_citacao(s.trecho_edital, paginas)
        if pagina is None or normalizar(s.trecho_edital) in ja_decididas:
            descartadas += 1  # trecho inventado (nunca vira sugestão) ou ponto já decidido antes
            continue
        fundamento, na_base = fundamento_verificado(s.fundamento, base)
        viab, aviso = ajustar_viabilidade(s.tipo, s.viabilidade, na_base)
        justificativa = " ".join(p for p in (s.viabilidade_justificativa, aviso) if p)[:500] or None
        limite = limites.get(s.tipo)
        no_prazo = tempestiva(limite, agora)
        conn.execute(
            "insert into priv.sugestoes_pecas (empresa_id, acompanhamento_id, execucao_id, tipo, titulo, trecho_edital, trecho_confere, pagina, duvida, impacto, pedido, "
            "fundamento, fundamento_na_base, viabilidade, viabilidade_justificativa, prazo_legal, status, modelo_ia) "
            "values (%s, %s, %s, %s, %s, %s, true, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (x["empresa_id"], x["acompanhamento_id"], x["id"], s.tipo, s.titulo, s.trecho_edital, pagina, s.duvida, s.impacto, s.pedido, fundamento, na_base, viab, justificativa,
             limite, "intempestiva" if no_prazo is False else "nova", resp.modelo),
        )  # fmt: skip
        criadas += 1
    conn.execute(
        "update priv.sugestoes_execucoes set status = 'concluida', modelo = %s, prompt_versao = %s, tokens_entrada = %s, tokens_saida = %s, criadas = %s, descartadas = %s, "
        "erro = %s, concluida_em = now() where id = %s",
        (
            resp.modelo,
            VERSAO_PROMPT,
            resp.tokens_entrada,
            resp.tokens_saida,
            criadas,
            descartadas,
            "texto do edital truncado no limite do pedido" if truncado else None,
            x["id"],
        ),
    )
    conn.commit()
    log.info(
        "sugestões de peças",
        extra={"ctx": {"execucao": str(x["id"]), "criadas": criadas, "descartadas": descartadas}},
    )
    return "concluida"


def _terminar(conn: psycopg.Connection[Any], id_: Any, status: str, erro: str) -> str:
    conn.execute(
        "update priv.sugestoes_execucoes set status = %s, erro = %s, concluida_em = now() where id = %s",
        (status, erro[:500], id_),
    )
    conn.commit()
    return status
