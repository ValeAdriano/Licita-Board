"""Jobs do parecer de viabilidade recursal (Fase 10, 10.4): `validar_parecer` (confere a evidência) e `analisar_vencedora` (IA sugere achados).

A IA só sugere achados com citação LITERAL do texto da concorrente; classificação, prova, fundamento e recomendação são humanos. A
validação (código puro, `rules/parecer.py`) reconfere as citações nos textos e a evidência de cada achado e bloqueia o que não tem prova.
Sem chave, a análise fica `desligada`. Nada da empresa vai ao provedor.
"""

import json
import logging
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.extracao import Cliente
from worker.llm.analise_vencedora import SISTEMA, VERSAO_PROMPT, interpretar, montar_usuario
from worker.llm.extracao_requisitos import ErroLLM
from worker.peca import _base
from worker.rules.evidencia import contem, pagina_da_citacao
from worker.rules.parecer import Achado, bloqueia, validar

log = logging.getLogger("worker.parecer")


def _paginas(conn: psycopg.Connection[Any], edital_id: Any) -> dict[int, str]:
    paginas: dict[int, str] = {}
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select pagina, texto from pub.trechos where edital_id = %s order by pagina, ordem",
            (edital_id,),
        )
        for r in cur.fetchall():
            paginas[r["pagina"]] = f"{paginas.get(r['pagina'], '')}\n{r['texto']}"
    return paginas


def _parecer(
    conn: psycopg.Connection[Any], parecer_id: str, empresa_job: Any
) -> dict[str, Any] | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select r.*, a.edital_id, i.descricao as item from priv.pareceres_recursais r join priv.participacoes p on p.id = r.participacao_id "
            "join priv.acompanhamentos a on a.id = p.acompanhamento_id left join pub.edital_itens i on i.id = p.item_id where r.id = %s",
            (parecer_id,),
        )
        r = cur.fetchone()
    if r is None or (empresa_job is not None and str(r["empresa_id"]) != str(empresa_job)):
        return None  # nunca confie no payload (T2)
    return r


def conferir(
    conn: psycopg.Connection[Any], parecer_id: str, empresa_job: Any = None
) -> bool | None:
    """Reconfere citações e evidência; grava `validacao`. Devolve se está bloqueado, ou None se o parecer não é da empresa do job."""
    r = _parecer(conn, parecer_id, empresa_job)
    if r is None:
        return None
    paginas = _paginas(conn, r["edital_id"])
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select * from priv.parecer_achados where parecer_id = %s and empresa_id = %s order by ordem",
            (r["id"], r["empresa_id"]),
        )
        linhas = cur.fetchall()
    achados: list[Achado] = []
    for a in linhas:
        conc = bool(a["citacao_concorrente"]) and contem(
            a["citacao_concorrente"], r["texto_concorrente"] or ""
        )
        pagina = pagina_da_citacao(a["citacao_edital"], paginas) if a["citacao_edital"] else None
        conn.execute(
            "update priv.parecer_achados set concorrente_confere = %s, edital_confere = %s, pagina_edital = %s where id = %s",
            (conc, pagina is not None, pagina, a["id"]),
        )
        achados.append(
            Achado(
                str(a["id"]),
                a["origem"],
                a["descricao"],
                a["classificacao"],
                a["prova"],
                a["fundamento"],
                a["citacao_concorrente"],
                conc,
                a["citacao_edital"],
                pagina is not None,
            )
        )
    div = validar(achados, r["recomendacao"], _base(conn, r["empresa_id"]))
    bloq = bloqueia(div)
    conn.execute(
        "update priv.pareceres_recursais set validacao = %s::jsonb, validada_em = now(), bloqueado = %s where id = %s",
        (json.dumps(div), bloq, r["id"]),
    )
    conn.commit()
    return bloq


def analisar(
    conn: psycopg.Connection[Any], parecer_id: str, cliente: Cliente | None, empresa_job: Any = None
) -> str | None:
    """Status final da análise, ou None se o parecer não é da empresa do job."""
    r = _parecer(conn, parecer_id, empresa_job)
    if r is None:
        return None
    if r["analise_status"] != "pendente":
        return str(r["analise_status"])  # idempotente
    if cliente is None:
        return _fim(conn, r["id"], "desligada", "IA não configurada para esta empresa")
    paginas = _paginas(conn, r["edital_id"])
    if not paginas:
        return _fim(conn, r["id"], "falhou", "o edital ainda não tem texto extraído")
    texto_edital = "".join(f"[página {p}]\n{t}\n" for p, t in sorted(paginas.items()))
    usuario, truncado = montar_usuario(
        r["item"] or "(item)", texto_edital, r["texto_concorrente"] or ""
    )
    try:
        resp = cliente.completar(SISTEMA, usuario)
        achados, descartados = interpretar(resp.texto)
    except ErroLLM as e:
        return _fim(conn, r["id"], "falhou", str(e))
    conn.execute(
        "delete from priv.parecer_achados where parecer_id = %s and empresa_id = %s and origem = 'ia' and classificacao is null and prova is null",
        (r["id"], r["empresa_id"]),
    )
    ordem = conn.execute(
        "select coalesce(max(ordem), 0) from priv.parecer_achados where parecer_id = %s", (r["id"],)
    ).fetchone()
    inicio = int(ordem[0]) if ordem else 0
    descartados_sem_citacao = 0
    n = 0
    for a in achados:
        if not contem(a.citacao_concorrente, r["texto_concorrente"] or ""):
            descartados_sem_citacao += (
                1  # citação inventada: o achado não entra (nunca vira "falha da concorrente")
            )
            continue
        n += 1
        conn.execute(
            "insert into priv.parecer_achados (empresa_id, parecer_id, ordem, origem, tipo, descricao, citacao_concorrente, citacao_edital, modelo_ia) "
            "values (%s, %s, %s, 'ia', %s, %s, %s, %s, %s)",
            (
                r["empresa_id"],
                r["id"],
                inicio + n,
                a.tipo,
                a.descricao,
                a.citacao_concorrente,
                a.citacao_edital,
                resp.modelo,
            ),
        )
    aviso = "texto truncado no limite do pedido" if truncado else None
    if descartados or descartados_sem_citacao:
        aviso = f"{descartados + descartados_sem_citacao} sugestão(ões) descartada(s) (formato ou citação não localizada)"
    conn.execute(
        "update priv.pareceres_recursais set analise_status = 'concluida', analise_modelo = %s, analise_prompt_versao = %s, analise_tokens_entrada = %s, "
        "analise_tokens_saida = %s, analise_erro = %s, analise_em = now() where id = %s",
        (resp.modelo, VERSAO_PROMPT, resp.tokens_entrada, resp.tokens_saida, aviso, r["id"]),
    )
    conn.commit()
    conferir(conn, str(r["id"]), r["empresa_id"])
    log.info("vencedora analisada", extra={"ctx": {"parecer": str(r["id"]), "achados": n}})
    return "concluida"


def _fim(conn: psycopg.Connection[Any], id_: Any, status: str, erro: str) -> str:
    conn.execute(
        "update priv.pareceres_recursais set analise_status = %s, analise_erro = %s, analise_em = now() where id = %s",
        (status, erro[:500], id_),
    )
    conn.commit()
    return status
