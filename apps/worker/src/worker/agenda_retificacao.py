"""Reavaliação ao retificar o edital (Fase 05, RF-05.9, spec §4.8). Roda a cada hora junto dos alertas.

Para cada acompanhamento aberto cujo edital ganhou versão nova desde a última notificação:
- avisa o responsável e os gestores (uma vez por versão) dizendo O QUE mudou, em fatos (o diff completo está na tela);
- se mudou data de propostas/abertura, marca "abertura a reconfirmar" (só uma pessoa desmarca, confirmando a abertura) e
  enfileira o recálculo dos prazos (o worker recalcula só o que a regra produz; override humano não é tocado);
- se mudou objeto ou itens, acrescenta o aviso "avalie reabrir o prazo de publicação" (⚖️ decisão humana: o sistema só avisa).
O texto do aviso jurídico é provisório (pergunta 13 da spec) e a regra de disparo ainda não foi validada pelo jurídico.
"""

import json
import logging
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.agenda_alertas import destinatarios

log = logging.getLogger("worker.agenda_retificacao")

ROTULO = {
    "itens": "itens", "arquivos": "arquivos", "objeto": "objeto", "situacao": "situação", "valor_estimado": "valor estimado",
    "data_encerramento_propostas": "fim do prazo de propostas", "data_abertura_propostas": "início das propostas",
    "data_sessao": "data da sessão", "data_publicacao": "data de publicação", "modalidade": "modalidade",
    "modo_disputa": "modo de disputa", "criterio_julgamento": "critério de julgamento", "numero_edital": "número do edital",
    "processo": "processo", "srp": "registro de preços", "link_origem": "link de origem", "link_portal": "link do portal",
}  # fmt: skip
MUDA_DATA = frozenset({"data_encerramento_propostas", "data_abertura_propostas", "data_sessao"})
MUDA_PROPOSTA = frozenset({"objeto", "itens"})


def _campos(conn: psycopg.Connection[Any], edital: Any, depois_de: int, ate: int) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            "select distinct unnest(campos_alterados) from pub.edital_versoes where edital_id = %s and versao > %s and versao <= %s",
            (edital, depois_de, ate),
        )
        return {r[0] for r in cur.fetchall()}


def reavaliar(conn: psycopg.Connection[Any]) -> dict[str, int]:
    r = {"avisados": 0, "reconfirmar": 0}
    cache: dict[Any, dict[str, list[Any]]] = {}
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select a.id, a.empresa_id, a.responsavel_id, a.edital_id, coalesce(a.retificacao_notificada_versao, a.edital_versao_vista) as notificada, "
            "e.versao_atual, e.numero_edital, g.razao_social as orgao from priv.acompanhamentos a "
            "join pub.editais e on e.id = a.edital_id join pub.orgaos g on g.id = e.orgao_id "
            "where a.deleted_at is null and a.status not in ('encerrado', 'desistiu') "
            "and e.versao_atual > coalesce(a.retificacao_notificada_versao, a.edital_versao_vista)",
        )
        pendentes = cur.fetchall()
    for a in pendentes:
        campos = _campos(conn, a["edital_id"], a["notificada"], a["versao_atual"])
        if campos:  # versão sem campo alterado (só reprocessamento) não gera aviso
            mudou_data = bool(campos & MUDA_DATA)
            lista = ", ".join(sorted(ROTULO.get(c, c) for c in campos))
            corpo = (
                f"{a['orgao']}"
                + (f" · nº {a['numero_edital']}" if a["numero_edital"] else "")
                + f": mudou {lista}."
            )
            if mudou_data:
                corpo += " Reconfirme a data de abertura."
            if campos & MUDA_PROPOSTA:
                corpo += " A retificação altera o conteúdo da proposta: avalie a necessidade de reabrir o prazo de publicação (decisão sua)."
            ds = destinatarios(conn, cache, a["empresa_id"])
            for u in {*ds["gestores"], *([a["responsavel_id"]] if a["responsavel_id"] else [])}:
                conn.execute(
                    "insert into core.notificacoes (usuario_id, empresa_id, modulo, tipo, titulo, corpo, link) "
                    "values (%s, %s, 'agenda', 'agenda_retificacao', 'Edital retificado', %s, %s)",
                    (u, a["empresa_id"], corpo[:1000], f"/agenda/acompanhamentos/{a['id']}"),
                )
            r["avisados"] += 1
            if mudou_data:
                conn.execute(
                    "update priv.acompanhamentos set abertura_reconfirmar = true where id = %s",
                    (a["id"],),
                )
                conn.execute(
                    "select ops.enfileirar_pesquisa('calcular_prazos', %s, %s::jsonb, %s)",
                    (
                        a["empresa_id"],
                        json.dumps({"acompanhamento_id": str(a["id"])}),
                        f"retif:{a['id']}:{a['versao_atual']}",
                    ),
                )
                r["reconfirmar"] += 1
        conn.execute(
            "update priv.acompanhamentos set retificacao_notificada_versao = %s where id = %s",
            (a["versao_atual"], a["id"]),
        )
    conn.commit()
    log.info("retificações reavaliadas", extra={"ctx": r})
    return r
