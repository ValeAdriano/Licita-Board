"""Arquivos dos editais (Fase 04, RF-04.9 e RF-04.10): baixar, verificar e extrair texto.

O download fica em memória até o veredito (nada não verificado é gravado no S3): tamanho, tipo real,
antivírus e SHA-256, o mesmo `verificar` dos documentos da empresa. Só o liberado vai para
`editais/{edital}/{sha256}`. Bloqueado, grande demais ou sem resposta ficam registrados com motivo
e o link de origem; a oportunidade não some.

Anexo compactado (decisão 6): o ZIP liberado é aberto na mesma transação (`compactados.inspecionar`)
e cada arquivo interno segue o mesmo caminho (tipo real, antivírus, SHA-256, S3, `extrair_texto`),
ligado ao ZIP por `arquivo_pai_id`. RAR, 7z, ZIP dentro de ZIP e ZIP com senha ficam
"compactado: pendente"; limite estourado ou nome inseguro, "compactado: recusado", sem nada parcial.
"""

import json
import logging
import subprocess
from datetime import datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.documentos import TIPOS_PERMITIDOS, Antivirus, Armazenamento, verificar
from worker.pesquisa.compactados import (
    COMPACTADOS,
    ZIP,
    CompactadoRecusadoError,
    Limites,
    inspecionar,
    ler,
)
from worker.pesquisa.http import ClienteHttp, ErroPermanente
from worker.pesquisa.texto import Ocr, dividir, extrair

log = logging.getLogger("worker.pesquisa.arquivos")

LIMITE_ARQUIVO = 100 * 1024 * 1024  # <A DEFINIR> (pergunta 5 da spec: 100 MB)
# Compactados são guardados (original, hash, antivírus); o ZIP é aberto, os demais ficam pendentes.
TIPOS_EDITAL = TIPOS_PERMITIDOS | COMPACTADOS
_NOMES = {
    "application/x-rar": "RAR",
    "application/vnd.rar": "RAR",
    "application/x-7z-compressed": "7z",
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


def baixar(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    arquivo_id: str,
    http: ClienteHttp,
    s3: Leitor,
    antivirus: Antivirus,
    *,
    limites: Limites = Limites(),  # noqa: B008 - imutável
) -> str:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id, edital_id, tipo, url_origem, status_arquivo, arquivo_pai_id "
            "from pub.edital_arquivos where id = %s",
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
    if v.tipo_real in COMPACTADOS:
        _expandir(conn, a, dados, v.tipo_real, s3=s3, antivirus=antivirus, lim=limites)
        conn.commit()
        return "liberado"
    conn.execute(
        "select ops.enfileirar_pesquisa('extrair_texto', null, %s::jsonb, %s)",
        (json.dumps({"arquivo_id": arquivo_id}), f"extrair:{arquivo_id}:{v.sha256}"),
    )
    conn.commit()
    return "liberado"


def _resultado_compactado(
    conn: psycopg.Connection[Any], arquivo_id: str, status: str, motivo: str | None
) -> None:
    conn.execute(
        "update pub.edital_arquivos set status_compactado = %s, motivo_compactado = %s, "
        "status_extracao = 'nao_suportado' where id = %s",
        (status, (motivo or "")[:300] or None, arquivo_id),
    )


def _expandir(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    pai: dict[str, Any],
    dados: bytes,
    tipo_real: str,
    *,
    s3: Leitor,
    antivirus: Antivirus,
    lim: Limites,
) -> str:
    """Abre o ZIP já liberado (na transação de quem chama, sem commit) e registra o resultado."""
    pai_id = str(pai["id"])
    if pai["arquivo_pai_id"] is not None:  # só por garantia: o filho compactado nunca chega aqui
        _resultado_compactado(
            conn, pai_id, "pendente", "compactado dentro de compactado (profundidade 1)"
        )
        return "pendente"
    if tipo_real != ZIP:
        _resultado_compactado(
            conn, pai_id, "pendente", f"formato {_NOMES.get(tipo_real, tipo_real)} não é extraído"
        )
        return "pendente"
    insp = inspecionar(dados, lim)
    if insp.status != "extraido":
        _resultado_compactado(conn, pai_id, insp.status, insp.motivo)
        log.info(
            "zip de edital não extraído",
            extra={"ctx": {"arquivo_id": pai_id, "status": insp.status}},
        )
        return insp.status
    n = 0
    try:
        with conn.transaction():  # savepoint: a releitura falhou, nenhum filho fica
            for nome, conteudo in ler(dados, insp, lim):
                n += _registrar_filho(
                    conn, pai, nome, conteudo, s3=s3, antivirus=antivirus, lim=lim
                )
    except CompactadoRecusadoError as e:
        _resultado_compactado(conn, pai_id, "recusado", str(e))
        return "recusado"
    _resultado_compactado(conn, pai_id, "extraido", None)
    log.info("zip de edital extraído", extra={"ctx": {"arquivo_id": pai_id, "arquivos": n}})
    return "extraido"


def _registrar_filho(  # noqa: PLR0913
    conn: psycopg.Connection[Any],
    pai: dict[str, Any],
    nome: str,
    conteudo: bytes,
    *,
    s3: Leitor,
    antivirus: Antivirus,
    lim: Limites,
) -> int:
    """Arquivo interno: o mesmo veredito dos demais; liberado vai ao S3 e à extração de texto."""
    v = verificar(conteudo, antivirus, lim.max_arquivo, TIPOS_EDITAL)
    chave = f"editais/{pai['edital_id']}/{v.sha256}" if v.status == "liberado" else None
    if chave is not None:
        s3.gravar(chave, conteudo)
    with conn.cursor() as cur:
        # Mesmo conteúdo duas vezes no ZIP (ou ZIP reprocessado): uma linha só.
        cur.execute(
            "insert into pub.edital_arquivos (edital_id, tipo, titulo, url_origem, coletado_em, tamanho, "
            "sha256, tipo_real, arquivo_chave, status_arquivo, motivo, arquivo_pai_id) "
            "values (%s, %s, %s, %s, now(), %s, %s, %s, %s, %s, %s, %s) "
            "on conflict (edital_id, url_origem, coalesce(sha256, '')) do nothing returning id",
            (
                pai["edital_id"],
                pai["tipo"],
                nome,
                pai["url_origem"],
                v.tamanho,
                v.sha256,
                v.tipo_real,
                chave,
                v.status,
                (v.motivo or "")[:300] or None,
                pai["id"],
            ),
        )
        linha = cur.fetchone()
    if linha is None or v.status != "liberado":
        return 0 if linha is None else 1
    filho = str(linha[0])
    if v.tipo_real in COMPACTADOS:  # profundidade 1: guardado e verificado, mas não aberto
        _resultado_compactado(
            conn, filho, "pendente", "compactado dentro de compactado (profundidade 1)"
        )
    else:
        conn.execute(
            "select ops.enfileirar_pesquisa('extrair_texto', null, %s::jsonb, %s)",
            (json.dumps({"arquivo_id": filho}), f"extrair:{filho}:{v.sha256}"),
        )
    return 1


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
