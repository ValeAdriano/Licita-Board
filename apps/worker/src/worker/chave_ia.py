"""Chave de IA da empresa (cadastrada pela interface): resolve o cliente do provedor e testa a chave.

A chave fica CIFRADA no banco (ADR-017); aqui ela é decifrada só em memória, na hora de chamar o provedor. Sem chave da empresa, cai na chave
global do servidor (`VV_ANTHROPIC_API_KEY`, opcional); sem nenhuma das duas, a IA fica DESLIGADA. Nada daqui vai para log.
"""

import logging
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.cripto import ErroDecifrar, contexto_chave_ia, decifrar
from worker.llm.extracao_requisitos import Anthropic, ErroLLM
from worker.settings import Settings

log = logging.getLogger("worker.chave_ia")


def cliente_da_empresa(
    conn: psycopg.Connection[Any], empresa: Any, s: Settings
) -> Anthropic | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select chave_cifrada, modelo from priv.empresa_ia where empresa_id = %s", (empresa,)
        )
        linha = cur.fetchone()
    if linha is not None:
        try:
            chave = decifrar(
                linha["chave_cifrada"], s.kek.get_secret_value(), contexto_chave_ia(str(empresa))
            )
        except ErroDecifrar:
            log.error(
                "chave de IA da empresa não pôde ser decifrada",
                extra={"ctx": {"empresa": str(empresa)}},
            )
            return None  # KEK trocada ou dado adulterado: tratada como IA desligada (a pessoa recadastra)
        return Anthropic(chave, linha["modelo"] or s.llm_modelo)
    global_ = s.anthropic_api_key.get_secret_value()
    return Anthropic(global_, s.llm_modelo) if global_ else None


def testar_chave(
    conn: psycopg.Connection[Any],
    empresa_payload: str,
    empresa_job: Any,
    s: Settings,
    cliente: Anthropic | None = None,
) -> str | None:
    """'ok' ou 'falhou' (gravado em priv.empresa_ia); None se o pedido não é da empresa do job (nunca confie no payload)."""
    if empresa_job is not None and str(empresa_job) != str(empresa_payload):
        return None
    cli = cliente or cliente_da_empresa(conn, empresa_payload, s)
    if cli is None:
        status, erro = "falhou", "não foi possível ler a chave cadastrada (cadastre-a de novo)"
    else:
        try:
            cli.testar()
            status, erro = "ok", None
        except ErroLLM as e:
            status, erro = "falhou", str(e)
    conn.execute(
        "update priv.empresa_ia set teste_status = %s, teste_erro = %s, teste_em = now() where empresa_id = %s",
        (status, erro, empresa_payload),
    )
    conn.commit()
    return status
