"""Anexo de edital em ZIP (Fase 04, decisão 6; Q-13a). ZIPs gerados no próprio teste, sem rede.
A parte com banco usa VV_ADMIN_URL_TEST (como test_texto) e roda como vv_worker."""

import io
import os
import stat
import struct
import zipfile
from datetime import UTC, datetime
from typing import Any

import pytest

from tests.test_coleta import _admin, _n, conn  # noqa: F401
from tests.test_texto import AvFalso, DownloadFalso, S3Falso, _primeiro_arquivo, pdf_simples
from worker.pesquisa.arquivos import baixar, extrair_texto
from worker.pesquisa.compactados import Limites, inspecionar, ler, nome_base

MB = 1024 * 1024


def zip_de(
    *entradas: tuple[str | zipfile.ZipInfo, bytes], metodo: int = zipfile.ZIP_DEFLATED
) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", metodo) as z:
        for nome, dados in entradas:
            z.writestr(nome, dados)
    return buf.getvalue()


def _alterar_cabecalhos(dados: bytes, campo: str, valor: int = 0) -> bytes:
    """Muda o mesmo campo no cabeçalho local e no diretório central (ZIP forjado)."""
    d = bytearray(dados)
    pos = {"flags": (6, 8), "metodo": (8, 10), "tamanho": (22, 24)}[campo]
    for assinatura, desloc in ((b"PK\x03\x04", pos[0]), (b"PK\x01\x02", pos[1])):
        i = 0
        while (i := d.find(assinatura, i)) != -1:
            fmt = "<I" if campo == "tamanho" else "<H"
            if campo == "flags":
                valor_final = struct.unpack_from("<H", d, i + desloc)[0] | 0x1
            else:
                valor_final = valor
            struct.pack_into(fmt, d, i + desloc, valor_final)
            i += 4
    return bytes(d)


def _info(nome: str, modo: int) -> zipfile.ZipInfo:
    i = zipfile.ZipInfo(nome)
    i.create_system = 3
    i.external_attr = modo << 16
    return i


# ----------------------------------------------------------------------------- sem banco
def test_zip_normal_extrai_com_nome_base() -> None:
    pdf = pdf_simples("Termo de referencia")
    z = zip_de(("edital/anexos/termo.pdf", pdf), ("edital/", b""), ("leia.txt", b"texto"))
    insp = inspecionar(z)
    assert insp.status == "extraido" and insp.motivo is None
    assert list(ler(z, insp)) == [("termo.pdf", pdf), ("leia.txt", b"texto")]


def test_zip_bomb_pela_razao_de_compressao_e_recusado() -> None:
    z = zip_de(("bomba.txt", b"\0" * (20 * MB)))
    assert len(z) < 100 * 1024  # mais de 100:1
    insp = inspecionar(z)
    assert insp.status == "recusado" and "razão de compressão" in (insp.motivo or "")
    assert list(ler(z, insp)) == []  # nada parcial


def test_arquivo_pequeno_compressivel_nao_e_bomba() -> None:
    assert inspecionar(zip_de(("espacos.txt", b" " * 500_000))).status == "extraido"


def test_arquivos_demais_recusa_o_zip_inteiro() -> None:
    z = zip_de(*((f"a{i}.txt", b"x") for i in range(51)))
    insp = inspecionar(z)
    assert insp.status == "recusado" and "mais de 50 arquivos" in (insp.motivo or "")
    assert inspecionar(zip_de(*((f"a{i}.txt", b"x") for i in range(50)))).status == "extraido"


def test_total_descompactado_acima_do_limite_e_recusado() -> None:
    lim = Limites(max_total=1 * MB, max_arquivo=1 * MB)
    z = zip_de(("a.bin", os.urandom(600_000)), ("b.bin", os.urandom(600_000)))
    insp = inspecionar(z, lim)
    assert insp.status == "recusado" and "conteúdo acima de 1 MB" in (insp.motivo or "")


def test_arquivo_interno_acima_do_limite_e_recusado() -> None:
    lim = Limites(max_arquivo=1 * MB)
    insp = inspecionar(zip_de(("grande.bin", os.urandom(2 * MB))), lim)
    assert insp.status == "recusado" and "arquivo interno acima de 1 MB" in (insp.motivo or "")


def test_conta_bytes_reais_e_nao_confia_no_tamanho_declarado() -> None:
    # Cabeçalho diz 10 bytes, o conteúdo real tem 2 MB de zeros: recusado, nunca aceito pelo cabeçalho.
    z = _alterar_cabecalhos(zip_de(("a.txt", b"\0" * (2 * MB))), "tamanho", 10)
    assert zipfile.ZipFile(io.BytesIO(z)).infolist()[0].file_size == 10
    assert inspecionar(z).status == "recusado"
    # Cabeçalho diz 1 byte, o real passa do limite por arquivo: a leitura em blocos para no limite.
    lim = Limites(max_arquivo=1 * MB)
    z2 = _alterar_cabecalhos(zip_de(("b.bin", os.urandom(2 * MB))), "tamanho", 1)
    assert inspecionar(z2, lim).status == "recusado"


@pytest.mark.parametrize(
    "nome", ["../../etc/passwd", "a/../../fora.txt", "/etc/cron.d/x", "C:\\Windows\\x.dll", "..\\x"]
)
def test_path_traversal_e_caminho_absoluto_recusam(nome: str) -> None:
    insp = inspecionar(zip_de(("ok.txt", b"ok"), (nome, b"x")))
    assert insp.status == "recusado" and "nome de arquivo inseguro" in (insp.motivo or "")


def test_link_simbolico_recusa() -> None:
    z = zip_de(("ok.txt", b"ok"), (_info("atalho", stat.S_IFLNK | 0o777), b"/etc/passwd"))
    insp = inspecionar(z)
    assert insp.status == "recusado" and insp.motivo == "link simbólico dentro do ZIP"


@pytest.mark.parametrize("tipo", [stat.S_IFCHR, stat.S_IFBLK, stat.S_IFIFO, stat.S_IFSOCK])
def test_dispositivo_e_arquivo_especial_recusam(tipo: int) -> None:
    insp = inspecionar(zip_de((_info("dev", tipo | 0o600), b"")))
    assert insp.status == "recusado" and insp.motivo == "arquivo especial dentro do ZIP"


def test_permissao_comum_sem_bits_de_tipo_e_arquivo_normal() -> None:
    assert inspecionar(zip_de((_info("a.txt", 0o644), b"oi"))).status == "extraido"
    assert inspecionar(zip_de((_info("b.txt", stat.S_IFREG | 0o644), b"oi"))).status == "extraido"


def test_criptografado_fica_pendente_por_senha() -> None:
    z = _alterar_cabecalhos(zip_de(("a.txt", b"segredo" * 10)), "flags")
    insp = inspecionar(z)
    assert (insp.status, insp.motivo) == ("pendente", "protegido por senha")
    assert list(ler(z, insp)) == []


def test_metodo_de_compressao_desconhecido_fica_pendente() -> None:
    z = _alterar_cabecalhos(zip_de(("a.txt", b"x" * 100)), "metodo", 9)  # deflate64
    assert inspecionar(z).status == "pendente"


def test_rar_e_lixo_nao_sao_zip() -> None:
    assert inspecionar(b"Rar!\x1a\x07\x01\x00" + bytes(range(256))).status == "recusado"
    assert inspecionar(b"").status == "recusado"
    assert inspecionar(zip_de(("vazio/", b""))).motivo == "ZIP sem arquivos"


def test_nome_base_normaliza() -> None:
    def info(nome: str, utf8: bool = True) -> zipfile.ZipInfo:
        i = zipfile.ZipInfo(nome)
        i.flag_bits = 0x800 if utf8 else 0
        return i

    assert nome_base(info("pasta\\sub\\Edital Nº 1.pdf")) == "Edital Nº 1.pdf"
    assert nome_base(info("./a/./b.pdf")) == "b.pdf"
    assert nome_base(info("tab\tcontrole\x07.pdf")) == "tabcontrole.pdf"
    longo = nome_base(info("x" * 400 + ".pdf"))
    assert longo is not None and len(longo) <= 200 and longo.endswith(".pdf")
    # ZIP do Windows sem flag UTF-8: o zipfile lê em cp437; o nome em português sai certo (cp850).
    assert nome_base(info(b"Licita\x87\xc6o.pdf".decode("cp437"), False)) == "Licitação.pdf"
    assert nome_base(info("..")) is None and nome_base(info("/")) is None


# ----------------------------------------------------------------------------- com banco
com_banco = pytest.mark.skipif(not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste")
AGORA = datetime(2026, 11, 4, tzinfo=UTC)


def _arquivo(aid: str) -> tuple[Any, ...]:
    return _admin(
        "select status_arquivo, tipo_real, status_compactado, motivo_compactado, status_extracao "
        "from pub.edital_arquivos where id = %s",
        aid,
    )[0]


def _filhos(aid: str) -> list[tuple[Any, ...]]:
    return _admin(
        "select titulo, status_arquivo, tipo_real, status_compactado, arquivo_chave, motivo, url_origem "
        "from pub.edital_arquivos where arquivo_pai_id = %s order by titulo",
        aid,
    )


@com_banco
def test_zip_extraido_segue_o_fluxo_normal_e_fica_ligado_ao_zip(conn: Any) -> None:
    aid = _primeiro_arquivo(conn)
    s3 = S3Falso()
    pdf = pdf_simples("Termo de referencia da cadeira escolar")
    z = zip_de(
        ("anexos/termo.pdf", pdf), ("copia/termo.pdf", pdf), ("planilha.exe", b"MZ\x90\x00" * 64)
    )
    assert baixar(conn, aid, DownloadFalso(z), s3, AvFalso()) == "liberado"  # type: ignore[arg-type]
    assert _arquivo(aid) == ("liberado", "application/zip", "extraido", None, "nao_suportado")
    filhos = _filhos(aid)
    url_pai = _admin("select url_origem from pub.edital_arquivos where id = %s", aid)[0][0]
    assert [(f[0], f[1]) for f in filhos] == [
        ("planilha.exe", "bloqueado"),
        ("termo.pdf", "liberado"),
    ]
    bloqueado, termo = filhos
    assert "tipo de arquivo não permitido" in bloqueado[5] and bloqueado[4] is None
    assert termo[4] in s3.objetos and s3.objetos[termo[4]] == pdf and termo[6] == url_pai
    # Só o PDF interno vai para a extração de texto; o ZIP não.
    assert _n("select count(*) from ops.jobs where tipo = 'extrair_texto'") == 1
    tid = str(_admin("select id from pub.edital_arquivos where titulo = 'termo.pdf'")[0][0])
    assert extrair_texto(conn, tid, s3, None, AGORA) == "ok"  # type: ignore[arg-type]
    assert _n(f"select count(*) from pub.trechos where arquivo_id = '{tid}'") == 1


@com_banco
def test_zip_bomb_recusado_sem_nenhum_filho(conn: Any) -> None:
    aid = _primeiro_arquivo(conn)
    s3 = S3Falso()
    z = zip_de(("ok.pdf", pdf_simples("Edital")), ("bomba.txt", b"\0" * (20 * MB)))
    baixar(conn, aid, DownloadFalso(z), s3, AvFalso())  # type: ignore[arg-type]
    st = _arquivo(aid)
    assert st[2] == "recusado" and "razão de compressão" in st[3]
    assert _filhos(aid) == [] and len(s3.objetos) == 1  # só o ZIP original, guardado com hash
    assert _n("select count(*) from ops.jobs where tipo = 'extrair_texto'") == 0


@com_banco
def test_limite_configuravel_recusa_o_zip_inteiro(conn: Any) -> None:
    aid = _primeiro_arquivo(conn)
    z = zip_de(("a.pdf", pdf_simples("A")), ("b.pdf", pdf_simples("B")))
    baixar(conn, aid, DownloadFalso(z), S3Falso(), AvFalso(), limites=Limites(max_arquivos=1))  # type: ignore[arg-type]
    assert _arquivo(aid)[2:4] == ("recusado", "mais de 1 arquivos no ZIP")
    assert _filhos(aid) == []


@com_banco
def test_zip_dentro_de_zip_e_guardado_mas_nao_aberto(conn: Any) -> None:
    aid = _primeiro_arquivo(conn)
    interno = zip_de(("fundo.pdf", pdf_simples("Fundo")))
    baixar(conn, aid, DownloadFalso(zip_de(("interno.zip", interno))), S3Falso(), AvFalso())  # type: ignore[arg-type]
    (f,) = _filhos(aid)
    assert f[:4] == ("interno.zip", "liberado", "application/zip", "pendente")
    assert _n("select count(*) from pub.edital_arquivos") == _n(
        "select count(*) from pub.edital_arquivos where titulo <> 'fundo.pdf'"
    )  # o PDF do fundo nunca vira arquivo
    assert _n("select count(*) from ops.jobs where tipo = 'extrair_texto'") == 0


@com_banco
def test_virus_dentro_do_zip_bloqueia_so_o_arquivo_interno(conn: Any) -> None:
    aid = _primeiro_arquivo(conn)
    s3 = S3Falso()
    z = zip_de(
        ("eicar.pdf", pdf_simples("x") + b"EICAR" * 40), ("ok.pdf", pdf_simples("Edital ok"))
    )
    assert b"EICAR" not in z  # o ZIP comprimido passa no antivírus falso; o arquivo interno não
    baixar(conn, aid, DownloadFalso(z), s3, AvFalso())  # type: ignore[arg-type]
    assert [(f[0], f[1], f[5]) for f in _filhos(aid)] == [
        ("eicar.pdf", "bloqueado", "antivírus: Eicar-Test-Signature"),
        ("ok.pdf", "liberado", None),
    ]
    assert not any(b"EICAR" in v for v in s3.objetos.values())


@com_banco
def test_rar_com_extensao_zip_e_criptografado_ficam_pendentes(conn: Any) -> None:
    aid = _primeiro_arquivo(conn)
    rar = (
        b"Rar!\x1a\x07\x01\x00" + bytes(range(256)) * 4
    )  # chamado de .zip na fonte: vale o tipo real
    baixar(conn, aid, DownloadFalso(rar), S3Falso(), AvFalso())  # type: ignore[arg-type]
    assert _arquivo(aid)[:4] == (
        "liberado",
        "application/vnd.rar",
        "pendente",
        "formato RAR não é extraído",
    )
    outro = str(_admin("select id from pub.edital_arquivos where id <> %s limit 1", aid)[0][0])
    z = _alterar_cabecalhos(zip_de(("a.pdf", pdf_simples("Secreto"))), "flags")
    baixar(conn, outro, DownloadFalso(z), S3Falso(), AvFalso())  # type: ignore[arg-type]
    assert _arquivo(outro)[2:4] == ("pendente", "protegido por senha")
    assert _filhos(aid) == [] and _filhos(outro) == []
