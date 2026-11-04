"""Job `coletar_fonte` (Fase 04): uma execução de uma fonte, do início ao registro do resultado.

Isolamento (RF-04.7): erro em UM registro vira `itens_pendentes` e a coleta segue; erro de rede que
esgota o retry falha a execução (o job volta com backoff) e, na última tentativa, conta contra a
fonte. Resultado parcial nunca é `ok`. Relógio por parâmetro.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.connectors.pncp import (
    CONSULTA,
    MODALIDADES,
    ConectorPNCP,
    Http,
    normalizar_compra,
)
from worker.pesquisa.agenda import FUSO, alertar_superadmins, pingar
from worker.pesquisa.http import ErroPermanente, ErroTransitorio
from worker.pesquisa.repositorio import gravar, ja_atualizado

log = logging.getLogger("worker.pesquisa.coleta")

FOLGA_JANELA = timedelta(hours=2)  # <A DEFINIR>: sobreposição para não perder publicação atrasada
FALHAS_PARA_INDISPONIVEL = 3  # <A DEFINIR>


def janela(
    ultimo_sucesso: datetime | None, agora: datetime, ini: datetime | None, fim: datetime | None
) -> tuple[datetime, datetime]:
    """Execução manual traz a janela; as programadas começam na última coleta ok menos a folga."""
    if ini and fim:
        return ini.astimezone(FUSO), fim.astimezone(FUSO)
    base = (ultimo_sucesso - FOLGA_JANELA) if ultimo_sucesso else agora - timedelta(days=1)
    return base.astimezone(FUSO), agora.astimezone(FUSO)


def _aaaammdd(d: datetime) -> str:
    return f"{d:%Y%m%d}"


def coletar(
    conn: psycopg.Connection[Any],
    execucao_id: str,
    http: Http,
    agora: datetime,
    ultima_tentativa: bool = True,
    heartbeat: str = "",
) -> str:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select e.id, e.tipo, e.fonte_id, e.janela_ini, e.janela_fim, e.detalhe, "
            "f.slug, f.parametros, f.ultimo_sucesso_em, f.falhas_consecutivas "
            "from ops.execucoes e join ops.fontes f on f.id = e.fonte_id where e.id = %s",
            (execucao_id,),
        )
        ex = cur.fetchone()
    if ex is None or ex["slug"] != "pncp":
        raise ErroPermanente("execução ou conector desconhecido")
    conn.execute(
        "update ops.execucoes set status = 'executando', iniciada_em = %s, concluida_em = null "
        "where id = %s",
        (agora, execucao_id),
    )
    conn.execute(
        "update ops.fontes set ultima_pesquisa_em = %s where id = %s", (agora, ex["fonte_id"])
    )
    conn.commit()

    ini, fim = janela(ex["ultimo_sucesso_em"], agora, ex["janela_ini"], ex["janela_fim"])
    par = ex["parametros"]
    ufs = [ex["detalhe"]["uf"]] if ex["detalhe"].get("uf") else par.get("ufs", ["PR", "SC"])
    modalidades = par.get("modalidades", MODALIDADES)
    conector = ConectorPNCP(http)
    cont = {"encontrados": 0, "novos": 0, "atualizados": 0, "pendentes": 0, "arquivos": 0}
    parcial = False
    vistos: set[str] = set()
    try:
        for endpoint in ("publicacao", "atualizacao"):
            for uf in ufs:
                for mod in modalidades:
                    lidas = 0
                    total = 0
                    for registros, meta in conector.listar(
                        endpoint, _aaaammdd(ini), _aaaammdd(fim), uf, int(mod)
                    ):
                        lidas += 1
                        total = int(meta.get("totalPaginas") or 0)
                        for raw in registros:
                            _processar(conn, ex["fonte_id"], conector, raw, vistos, cont)
                    if lidas < total:  # paginação incompleta: não é sucesso
                        parcial = True
    except (ErroTransitorio, ErroPermanente) as e:
        _falha(conn, ex, execucao_id, agora, type(e).__name__, str(e), ultima_tentativa, cont)
        raise

    parcial = parcial or cont["pendentes"] > 0
    status = "parcial" if parcial else "ok"
    conn.execute(
        "update ops.execucoes set status = %s, concluida_em = %s, processos_encontrados = %s, "
        "editais_novos = %s, editais_atualizados = %s, itens_pendentes = %s, arquivos_baixados = 0 "
        "where id = %s",
        (
            status,
            agora,
            cont["encontrados"],
            cont["novos"],
            cont["atualizados"],
            cont["pendentes"],
            execucao_id,
        ),
    )
    if status == "ok":
        conn.execute(
            "update ops.fontes set status = 'ok', falhas_consecutivas = 0, ultimo_sucesso_em = %s, "
            "ultimo_resultado = %s where id = %s",
            (agora, f"{cont['encontrados']} processos, {cont['novos']} novos", ex["fonte_id"]),
        )
    else:
        conn.execute(
            "update ops.fontes set status = 'degradada', ultimo_resultado = %s where id = %s",
            (f"parcial: {cont['pendentes']} registros com erro", ex["fonte_id"]),
        )
    conn.execute(
        "insert into ops.fonte_checagens (fonte_id, ok) values (%s, true)", (ex["fonte_id"],)
    )
    conn.commit()
    if status == "ok":
        pingar(heartbeat)
    return status


def _processar(
    conn: psycopg.Connection[Any],
    fonte_id: Any,
    conector: ConectorPNCP,
    raw: dict[str, Any],
    vistos: set[str],
    cont: dict[str, int],
) -> None:
    try:
        compra = normalizar_compra(raw)
        if compra.id_externo in vistos:
            return
        vistos.add(compra.id_externo)
        cont["encontrados"] += 1
        if ja_atualizado(conn, fonte_id, compra) is not None:
            return
        r = gravar(conn, fonte_id, conector.detalhar(compra))
    except (ErroTransitorio, ErroPermanente) as e:
        conn.rollback()
        # Um registro que a fonte recusa (4xx) é isolado; falha de rede esgotada derruba a execução.
        if isinstance(e, ErroTransitorio):
            raise
        cont["pendentes"] += 1
        log.warning("registro isolado", extra={"ctx": {"erro": str(e)[:80]}})
        return
    except (
        KeyError,
        ValueError,
        TypeError,
        ArithmeticError,
        psycopg.DataError,
        psycopg.IntegrityError,
    ) as e:
        conn.rollback()
        cont["pendentes"] += 1  # resposta malformada: isola o registro, a coleta segue
        log.warning("registro malformado", extra={"ctx": {"erro": type(e).__name__}})
        return
    if r.situacao == "novo":
        cont["novos"] += 1
    elif r.situacao == "atualizado":
        cont["atualizados"] += 1
    if r.situacao != "igual":
        # Etapas seguintes (arquivos e relevância) nascem do evento; chave por edital e versão.
        for aid in r.arquivos_novos:
            conn.execute(
                "select ops.enfileirar_pesquisa('baixar_arquivo_edital', null, %s::jsonb, %s)",
                (json.dumps({"arquivo_id": aid}), f"baixar:{aid}"),
            )
            cont["arquivos"] += 1
        conn.execute(
            "select ops.enfileirar_pesquisa('avaliar_relevancia', null, %s::jsonb, %s)",
            (
                json.dumps({"edital_id": r.edital_id, "versao": r.versao}),
                f"avaliar:{r.edital_id}:{r.versao}",
            ),
        )
        conn.commit()


def _falha(
    conn: psycopg.Connection[Any],
    ex: dict[str, Any],
    execucao_id: str,
    agora: datetime,
    erro: str,
    detalhe: str,
    ultima_tentativa: bool,
    cont: dict[str, int],
) -> None:
    conn.rollback()
    conn.execute(
        "update ops.execucoes set status = 'falhou', concluida_em = %s, erro_tipo = %s, "
        "processos_encontrados = %s, itens_pendentes = %s, detalhe = detalhe || %s::jsonb where id = %s",
        (
            agora,
            erro[:100],
            cont["encontrados"],
            cont["pendentes"],
            json.dumps({"erro": detalhe[:100]}),
            execucao_id,
        ),
    )
    conn.execute(
        "insert into ops.fonte_checagens (fonte_id, ok, erro_tipo) values (%s, false, %s)",
        (ex["fonte_id"], erro[:100]),
    )
    if ultima_tentativa:  # só a última tentativa do job conta contra a fonte
        falhas = ex["falhas_consecutivas"] + 1
        indisponivel = falhas >= FALHAS_PARA_INDISPONIVEL
        conn.execute(
            "update ops.fontes set falhas_consecutivas = %s, status = %s, ultimo_resultado = %s where id = %s",
            (
                falhas,
                "indisponivel" if indisponivel else "degradada",
                f"falha: {erro}"[:300],
                ex["fonte_id"],
            ),
        )
        if indisponivel and ex["falhas_consecutivas"] < FALHAS_PARA_INDISPONIVEL:
            alertar_superadmins(
                conn, agora, "fonte_indisponivel", "Fonte de editais indisponível", ex["slug"]
            )
    conn.commit()


__all__ = ["CONSULTA", "coletar", "janela"]
