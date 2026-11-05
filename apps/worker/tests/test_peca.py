"""Job processar_peca com banco (VV_ADMIN_URL_TEST): citação fora da base verificada bloqueia; final com hash e PDF; empresa do job."""

import hashlib
import io
import os
import uuid
import zipfile
from datetime import date
from typing import Any
from unittest.mock import patch

import psycopg
import pytest

from tests.test_coleta import _admin
from worker.peca import processar

pytestmark = pytest.mark.skipif(
    not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste"
)
HOJE = date(2026, 11, 10)


class S3Falso:
    def __init__(self) -> None:
        self.objetos: dict[str, bytes] = {}

    def gravar(self, chave: str, dados: bytes) -> None:
        self.objetos[chave] = dados

    def ler(self, chave: str) -> bytes:
        return self.objetos[chave]


@pytest.fixture
def cena() -> Any:
    assert _admin("select current_database()")[0][0] != "vv"
    emp = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, 'Jurídico Teste', '11222333000181')",
        emp,
    )
    usuario = _admin(
        "insert into core.usuarios (email, nome, oab, email_verificado_em) values (%s, 'Dra. Advogada', 'PR 12345', now()) returning id",
        f"j-{uuid.uuid4().hex[:8]}@exemplo.test",
    )[0][0]
    fonte = _admin("select id from ops.fontes where slug = 'pncp'")[0][0]
    org = _admin(
        "insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values (%s, 'Prefeitura de Teste', 'PR', '4106902') returning id",
        f"{uuid.uuid4().int % 10**14:014d}",
    )[0][0]
    ed = _admin("insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values (%s, %s, %s, '5/2026', 'x', repeat('a', 64)) returning id", fonte, f"PC-{uuid.uuid4()}", org)[0][0]  # fmt: skip
    ac = _admin(
        "insert into priv.acompanhamentos (empresa_id, edital_id) values (%s, %s) returning id",
        emp,
        ed,
    )[0][0]
    _admin("insert into priv.base_juridica (empresa_id, tipo, numero, dispositivo, titulo, link_oficial, verificada_por, verificada_em) values (%s, 'lei', '14.133/2021', 'art. 165', 'Lei 14.133/2021, art. 165', 'https://www.planalto.gov.br/x', %s, now())", emp, usuario)  # fmt: skip
    _admin("insert into priv.base_juridica (empresa_id, tipo, numero, dispositivo, titulo, link_oficial) values (%s, 'lei', '14.133/2021', 'art. 37', 'art. 37 (NÃO verificado)', 'https://www.planalto.gov.br/x')", emp)  # fmt: skip
    peca = _admin("insert into priv.pecas (empresa_id, acompanhamento_id, tipo, titulo, status, minuta, clausulas) values (%s, %s, 'impugnacao', 'Impugnação ao item 3', 'minuta', %s, 'Cláusula 7.2, página 12') returning id",
        emp, ac, "A cláusula 7.2 restringe a competitividade, em violação do art. 165 da Lei 14.133/2021.\n\nRequer-se a exclusão da exigência de marca.")[0][0]  # fmt: skip
    conn = psycopg.connect(os.environ["VV_ADMIN_URL_TEST"])
    conn.execute("set role vv_worker")
    conn.commit()
    yield {"conn": conn, "emp": emp, "peca": str(peca), "usuario": usuario, "s3": S3Falso()}
    conn.close()
    _admin("alter table priv.pecas disable trigger pecas_final_imutavel")
    _admin("delete from priv.pecas")
    _admin("alter table priv.pecas enable trigger pecas_final_imutavel")
    _admin("delete from priv.base_juridica")
    _admin("delete from priv.acompanhamentos")
    _admin("alter table core.empresas disable trigger user")
    _admin("delete from core.empresas where id = %s", emp)
    _admin("alter table core.empresas enable trigger user")
    _admin("delete from core.usuarios where id = %s", usuario)


def _p(c: dict[str, Any]) -> Any:
    return _admin(
        "select status, bloqueada, validacao, arquivo_chave, arquivo_sha256, arquivo_pdf_chave from priv.pecas where id = %s",
        c["peca"],
    )[0]


def _roda(c: dict[str, Any]) -> str | None:
    return processar(c["conn"], c["peca"], c["s3"], HOJE, c["emp"])


def test_minuta_com_citacao_da_base_verificada_passa(cena: Any) -> None:
    assert _roda(cena) == "minuta"
    status, bloqueada, validacao, *_ = _p(cena)
    assert (status, bloqueada, [v for v in validacao if v["bloqueia"]]) == ("minuta", False, [])


def test_citacao_inventada_ou_de_entrada_nao_verificada_bloqueia(cena: Any) -> None:
    _admin(
        "update priv.pecas set minuta = %s where id = %s",
        "Violação do art. 37 da Lei 14.133/2021 e da Lei 8.666/1993, conforme o Acórdão 999/2022 do TCU, na cláusula 7.2 do edital.",
        cena["peca"],
    )
    _roda(cena)
    _, bloqueada, validacao, *_ = _p(cena)
    trechos = " | ".join(v["mensagem"] for v in validacao if v["codigo"] == "citacao_fora_da_base")
    assert (
        bloqueada is True
        and "art. 37" in trechos
        and "Lei 8.666/1993" in trechos
        and "Acórdão 999/2022" in trechos
    )
    assert (
        "art. 165" not in trechos
    )  # o artigo verificado não é acusado (o 37 só existe como entrada NÃO verificada)


def test_sem_clausulas_ou_minuta_curta_bloqueia_e_base_vazia_so_avisa(cena: Any) -> None:
    _admin("update priv.pecas set clausulas = null, minuta = 'curta' where id = %s", cena["peca"])
    _admin("delete from priv.base_juridica")
    _roda(cena)
    _, bloqueada, validacao, *_ = _p(cena)
    assert bloqueada is True and {v["codigo"] for v in validacao} == {
        "minuta_vazia",
        "sem_clausulas",
        "base_vazia",
    }
    assert [v["bloqueia"] for v in validacao if v["codigo"] == "base_vazia"] == [False]


def test_aprovada_gera_o_final_com_hash_pdf_e_texto_correto_e_fica_imutavel(cena: Any) -> None:
    _admin(
        "update priv.pecas set status = 'aprovada', aprovado_por = %s, aprovado_em = now() where id = %s",
        cena["usuario"],
        cena["peca"],
    )
    with patch("worker.peca.docx_para_pdf", return_value=b"%PDF-1.7 teste"):
        assert _roda(cena) == "final"
    status, bloqueada, _, chave, sha, pdf = _p(cena)
    assert status == "final" and bloqueada is False and pdf and pdf.endswith(".pdf")
    dados = cena["s3"].objetos[chave]
    assert hashlib.sha256(dados).hexdigest() == sha
    xml = zipfile.ZipFile(io.BytesIO(dados)).read("word/document.xml").decode()
    assert (
        "IMPUGNAÇÃO AO EDITAL" in xml
        and "Jurídico Teste" in xml
        and "5/2026" in xml
        and "Cláusula 7.2, página 12" in xml
        and "Dra. Advogada" in xml
        and "OAB PR 12345" in xml
    )
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        _admin("update priv.pecas set minuta = 'alterada' where id = %s", cena["peca"])
    assert (
        _roda(cena) == "final" and len(cena["s3"].objetos) == 2
    )  # idempotente: docx e pdf, sem regravar


def test_base_que_perdeu_a_verificacao_derruba_a_aprovacao_sem_gerar_nada(cena: Any) -> None:
    _admin(
        "update priv.pecas set status = 'aprovada', aprovado_por = %s, aprovado_em = now() where id = %s",
        cena["usuario"],
        cena["peca"],
    )
    _admin("update priv.base_juridica set deleted_at = now() where dispositivo = 'art. 165'")
    assert _roda(cena) == "minuta"
    assert _p(cena)[0] == "minuta" and cena["s3"].objetos == {}
    assert _admin("select aprovado_em from priv.pecas where id = %s", cena["peca"])[0][0] is None


def test_peca_de_outra_empresa_e_ignorada(cena: Any) -> None:
    assert processar(cena["conn"], cena["peca"], cena["s3"], HOJE, str(uuid.uuid4())) is None
    assert _admin("select validada_em from priv.pecas where id = %s", cena["peca"])[0][0] is None
