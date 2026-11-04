"""Arquivos dos editais (Fase 04, RF-04.9 e RF-04.10): baixar, verificar e extrair texto.

O download fica em memória até o veredito (nada não verificado é gravado no S3): tamanho, tipo real,
antivírus e SHA-256, o mesmo `verificar` dos documentos da empresa. Só o liberado vai para
`editais/{edital}/{sha256}`. Bloqueado, grande demais ou sem resposta ficam registrados com motivo
e o link de origem; a oportunidade não some.
"""

import json
import logging
import subprocess
from datetime import datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.documentos import TIPOS_PERMITIDOS, Antivirus, Armazenamento, verificar
from worker.pesquisa.http import ClienteHttp, ErroPermanente
from worker.pesquisa.texto import Ocr, dividir, extrair

log = logging.getLogger("worker.pesquisa.arquivos")

LIMITE_ARQUIVO = 100 * 1024 * 1024  # <A DEFINIR> (pergunta 5 da spec: 100 MB)
# Compactados são guardados (original, hash, antivírus), mas o texto deles fica pendente.
TIPOS_EDITAL = TIPOS_PERMITIDOS | {
    "application/zip",
    "application/x-rar",
    "application/vnd.rar",
    "application/x-7z-compressed",
}


class Leitor(Armazenamento):  # só para tipagem: o S3 do worker também grava
    def gravar(self, chave: str, dados: bytes) -> None: ...


def _marcar(
    conn: psycopg.Connection[Any], arquivo_id: str, status: str, motivo: str | None
) -> None:
    conn.execute(
        "update pub.edital_arquivos set status_arquivo = %s, motivo = %s, coletado_em = now() "
        "where id = %s",
        (status, (motivo or "")[:300] or None, arquivo_id),
    )
    conn.commit()


def baixar(
    conn: psycopg.Connection[Any],
    arquivo_id: str,
    http: ClienteHttp,
    s3: Leitor,
    antivirus: Antivirus,
) -> str:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id, edital_id, url_origem, status_arquivo from pub.edital_arquivos where id = %s",
            (arquivo_id,),
        )
        a = cur.fetchone()
    if a is None or a["status_arquivo"] not in ("pendente", "falhou"):
        return "ja_processado"
    try:
        dados = http.get_bytes(a["url_origem"], LIMITE_ARQUIVO)
    except ErroPermanente as e:
        grande = "limite" in str(e)
        _marcar(conn, arquivo_id, "grande_demais" if grande else "falhou", str(e))
        return "grande_demais" if grande else "falhou"
    v = verificar(dados, antivirus, LIMITE_ARQUIVO, TIPOS_EDITAL)
    if v.status != "liberado":
        conn.execute(
            "update pub.edital_arquivos set status_arquivo = 'bloqueado', motivo = %s, tamanho = %s, "
            "tipo_real = %s, coletado_em = now() where id = %s",
            ((v.motivo or "")[:300], v.tamanho, v.tipo_real, arquivo_id),
        )
        conn.commit()
        log.info("arquivo de edital bloqueado", extra={"ctx": {"arquivo_id": arquivo_id}})
        return "bloqueado"
    chave = f"editais/{a['edital_id']}/{v.sha256}"
    s3.gravar(chave, dados)
    try:
        conn.execute(
            "update pub.edital_arquivos set status_arquivo = 'liberado', sha256 = %s, tamanho = %s, "
            "tipo_real = %s, arquivo_chave = %s, motivo = null, coletado_em = now() where id = %s",
            (v.sha256, v.tamanho, v.tipo_real, chave, arquivo_id),
        )
    except psycopg.errors.UniqueViolation:  # mesmo conteúdo já coletado nesta URL
        conn.rollback()
        _marcar(conn, arquivo_id, "falhou", "conteúdo já coletado")
        return "duplicado"
    conn.execute(
        "select ops.enfileirar_pesquisa('extrair_texto', null, %s::jsonb, %s)",
        (json.dumps({"arquivo_id": arquivo_id}), f"extrair:{arquivo_id}:{v.sha256}"),
    )
    conn.commit()
    return "liberado"


def extrair_texto(
    conn: psycopg.Connection[Any], arquivo_id: str, s3: Leitor, ocr: Ocr | None, agora: datetime
) -> str:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id, edital_id, arquivo_chave, tipo_real from pub.edital_arquivos "
            "where id = %s and status_arquivo = 'liberado'",
            (arquivo_id,),
        )
        a = cur.fetchone()
    if a is None:
        return "indisponivel"
    try:
        ex = extrair(s3.ler(a["arquivo_chave"]), a["tipo_real"], ocr)
    except (subprocess.SubprocessError, OSError, ValueError, MemoryError) as e:
        log.warning("extração falhou", extra={"ctx": {"erro": type(e).__name__}})
        conn.execute(
            "update pub.edital_arquivos set status_extracao = 'falhou' where id = %s", (arquivo_id,)
        )
        conn.commit()
        return "falhou"
    # Regrava de forma atômica: rodar de novo troca os trechos, não duplica.
    conn.execute("delete from pub.trechos where arquivo_id = %s", (arquivo_id,))
    ordem = 0
    for p in ex.paginas:
        for t in dividir(p.texto):
            conn.execute(
                "insert into pub.trechos (edital_id, arquivo_id, pagina, ordem, texto, origem_extracao, "
                "confianca_ocr) values (%s, %s, %s, %s, %s, %s, %s)",
                (a["edital_id"], arquivo_id, p.numero, ordem, t, p.origem, p.confianca),
            )
            ordem += 1
    conn.execute(
        "update pub.edital_arquivos set status_extracao = %s, paginas = %s where id = %s",
        (ex.status, ex.total_paginas or None, arquivo_id),
    )
    if ordem:
        conn.execute(
            "select ops.enfileirar_pesquisa('indexar_trechos', null, %s::jsonb, %s)",
            (json.dumps({"arquivo_id": arquivo_id}), f"indexar:{arquivo_id}:{agora:%Y%m%d%H%M%S}"),
        )
    conn.commit()
    return ex.status
