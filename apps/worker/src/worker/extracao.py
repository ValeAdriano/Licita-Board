"""Job `extrair_requisitos` (Fase 06): pede à IA os requisitos de UM item, confere as citações no texto do edital e grava como SUGESTÃO.

A IA só sugere. Cada requisito grava `origem = 'ia'`, modelo e versão do prompt, sem confirmação (a análise o trata como "A CONFIRMAR"
até uma pessoa confirmar). A citação que NÃO existe no texto do edital é descartada do requisito (fica sem citação: nunca vira ATENDE).
Sem chave configurada: status `desligada`. Nenhum dado da empresa, custo ou margem vai ao provedor.
"""

import logging
from decimal import Decimal
from typing import Any, Protocol

import psycopg
from psycopg.rows import dict_row

from worker.llm.extracao_requisitos import (
    SISTEMA,
    VERSAO_PROMPT,
    ErroLLM,
    Resposta,
    interpretar,
    montar_usuario,
)
from worker.rules.evidencia import pagina_da_citacao

log = logging.getLogger("worker.extracao")


class Cliente(Protocol):
    modelo: str

    def completar(self, sistema: str, usuario: str) -> Resposta: ...


def extrair(
    conn: psycopg.Connection[Any],
    extracao_id: str,
    cliente: Cliente | None,
    empresa_job: Any = None,
) -> str | None:
    """Devolve o status final ou None se a extração não existe/não é da empresa do job."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select x.id, x.empresa_id, x.participacao_id, x.status, i.descricao as item, a.edital_id from priv.extracoes_ia x "
            "join priv.participacoes p on p.id = x.participacao_id join priv.acompanhamentos a on a.id = p.acompanhamento_id "
            "left join pub.edital_itens i on i.id = p.item_id where x.id = %s",
            (extracao_id,),
        )
        x = cur.fetchone()
        if x is None or (empresa_job is not None and str(x["empresa_id"]) != str(empresa_job)):
            return None  # nunca confie no payload (T2)
        if x["status"] != "pendente":
            return str(x["status"])  # idempotente: já foi tratada
        if cliente is None:
            conn.execute(
                "update priv.extracoes_ia set status = 'desligada', erro = 'IA não configurada neste servidor', concluida_em = now() where id = %s",
                (x["id"],),
            )
            conn.commit()
            return "desligada"
        cur.execute("select id, nome, tipo, grandeza from pub.atributos_def order by id")
        atributos = cur.fetchall()
        cur.execute("select simbolo, id from pub.unidades order by simbolo")
        unidades = {r["simbolo"]: r["id"] for r in cur.fetchall()}
        cur.execute(
            "select pagina, texto from pub.trechos where edital_id = %s order by pagina, ordem",
            (x["edital_id"],),
        )
        paginas: dict[int, str] = {}
        for r in cur.fetchall():
            paginas[r["pagina"]] = f"{paginas.get(r['pagina'], '')}\n{r['texto']}"
    if not paginas:
        return _falha(conn, x["id"], "o edital ainda não tem texto extraído")
    codigos = {f"A{n}": a for n, a in enumerate(atributos, 1)}
    usuario, truncado = montar_usuario(
        x["item"] or "(item sem descrição)",
        [(c, a["nome"], a["tipo"], a["grandeza"]) for c, a in codigos.items()],
        list(unidades),
        paginas,
    )
    try:
        resp = cliente.completar(SISTEMA, usuario)
        requisitos, descartados = interpretar(resp.texto)
    except ErroLLM as e:
        return _falha(conn, x["id"], str(e))
    criados = sem_citacao = 0
    for q in requisitos:
        pagina = pagina_da_citacao(q.citacao, paginas)
        if pagina is None:
            sem_citacao += 1  # citação inventada ou alterada: o requisito fica, mas SEM citação (nunca será ATENDE)
        atributo = codigos.get(q.atributo_codigo or "")
        numerico = q.operador in (">=", "<=", "=", "entre")
        if (
            (numerico and q.valor_numero is None and not (q.operador == "=" and q.valor_texto))
            or (q.operador == "entre" and q.valor_max is None)
            or (q.operador == "contem" and not q.valor_texto)
        ):
            descartados += 1
            continue
        conn.execute(
            "insert into priv.requisitos_item (empresa_id, participacao_id, nome, tipo_exigencia, atributo_id, operador, valor_numero, valor_max, valor_texto, unidade_id, "
            "obrigatorio, citacao_edital, pagina, origem, modelo_ia, prompt_versao) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'ia', %s, %s)",
            (x["empresa_id"], x["participacao_id"], q.nome, q.tipo_exigencia, atributo["id"] if atributo else None, q.operador,
             Decimal(q.valor_numero) if q.valor_numero is not None else None, Decimal(q.valor_max) if q.valor_max is not None else None, q.valor_texto,
             unidades.get(q.unidade or ""), q.obrigatorio, q.citacao if pagina is not None else None, pagina, resp.modelo, VERSAO_PROMPT),
        )  # fmt: skip
        criados += 1
    conn.execute(
        "update priv.extracoes_ia set status = 'concluida', modelo = %s, prompt_versao = %s, tokens_entrada = %s, tokens_saida = %s, requisitos_criados = %s, descartados = %s, "
        "sem_citacao = %s, erro = %s, concluida_em = now() where id = %s",
        (
            resp.modelo,
            VERSAO_PROMPT,
            resp.tokens_entrada,
            resp.tokens_saida,
            criados,
            descartados,
            sem_citacao,
            "texto do edital truncado no limite do pedido" if truncado else None,
            x["id"],
        ),
    )
    # há análises deste item: os requisitos novos entram como "A CONFIRMAR" e a matriz é recalculada
    for (analise,) in conn.execute(
        "select id from priv.analises_item where participacao_id = %s and empresa_id = %s",
        (x["participacao_id"], x["empresa_id"]),
    ).fetchall():
        conn.execute(
            "select ops.enfileirar_pesquisa('analisar_item', %s, %s::jsonb, %s)",
            (
                x["empresa_id"],
                f'{{"analise_id": "{analise}"}}',
                f"analise:{analise}:ia:{extracao_id}",
            ),
        )
    conn.commit()
    log.info(
        "requisitos extraídos",
        extra={
            "ctx": {
                "extracao": str(x["id"]),
                "criados": criados,
                "descartados": descartados,
                "sem_citacao": sem_citacao,
            }
        },
    )
    return "concluida"


def _falha(conn: psycopg.Connection[Any], id_: Any, erro: str) -> str:
    conn.execute(
        "update priv.extracoes_ia set status = 'falhou', erro = %s, concluida_em = now() where id = %s",
        (erro[:500], id_),
    )
    conn.commit()
    return "falhou"
