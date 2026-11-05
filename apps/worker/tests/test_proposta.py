"""Job gerar_proposta com banco (VV_ADMIN_URL_TEST): valida, gera o .docx final com hash e bloqueia; divergência devolve a rascunho."""

import hashlib
import io
import json
import os
import uuid
import zipfile
from datetime import UTC, date, datetime
from typing import Any
from unittest.mock import patch

import psycopg
import pytest

from tests.test_coleta import _admin
from worker.pdf import PdfIndisponivel
from worker.proposta import gerar_proposta

pytestmark = pytest.mark.skipif(
    not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste"
)
HOJE = date(2026, 11, 10)
ABERTURA = datetime(2026, 12, 16, 13, 0, tzinfo=UTC)
ENVELOPE = '{"v":1,"dek":"AwMDAwMDAwMDAwMDWs7ANpmNfrFp5lKrYrYW7a/+lBPp+qmFUh025GzZztjAjAvOQqnWWi0Gbe39S6cx","iv":"AgICAgICAgICAgIC","ct":"ZL6oPy96sZSrjNmwOcqy3s2bpYqYxRwVPyjJbhwB7BFbac+93VU="}'


class S3Falso:
    def __init__(self) -> None:
        self.objetos: dict[str, bytes] = {}

    def ler(self, chave: str) -> bytes:
        return self.objetos[chave]

    def gravar(self, chave: str, dados: bytes) -> None:
        self.objetos[chave] = dados


@pytest.fixture
def cena() -> Any:
    assert _admin("select current_database()")[0][0] != "vv"
    emp = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, 'Proposta Teste Ltda', '11222333000181')",
        emp,
    )
    rep = _admin(
        "insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash, cargo) values (%s, 'SOCIO_ADMINISTRADOR', 'Maria Representante', %s::jsonb, '***', %s, 'Sócia-administradora') returning id",
        emp, ENVELOPE, uuid.uuid4().hex + uuid.uuid4().hex,
    )[0][0]  # fmt: skip
    _admin(
        "insert into core.representante_poderes (representante_id, empresa_id, poder) values (%s, %s, 'assinar_proposta')",
        rep,
        emp,
    )
    fonte = _admin("select id from ops.fontes where slug = 'pncp'")[0][0]
    org = _admin(
        "insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values (%s, 'Prefeitura de Teste', 'PR', '4106902') returning id",
        f"{uuid.uuid4().int % 10**14:014d}",
    )[0][0]
    ed = _admin(
        "insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values (%s, %s, %s, '12/2026', 'x', repeat('a', 64)) returning id",
        fonte, f"PP-{uuid.uuid4()}", org,
    )[0][0]  # fmt: skip
    item = _admin(
        "insert into pub.edital_itens (edital_id, numero_item, descricao, quantidade, valor_unitario_estimado) values (%s, 1, 'Veículo utilitário', 10, 200) returning id",
        ed,
    )[0][0]
    ac = _admin(
        "insert into priv.acompanhamentos (empresa_id, edital_id, data_abertura, abertura_confirmada) values (%s, %s, %s, true) returning id",
        emp,
        ed,
        ABERTURA,
    )[0][0]
    part = _admin(
        "insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values (%s, %s, %s) returning id",
        emp,
        ac,
        item,
    )[0][0]
    cat = _admin("select id from pub.categorias where slug = 'veiculos'")[0][0]
    prod = _admin(
        "insert into priv.produtos (empresa_id, categoria_id, codigo_interno, marca, modelo, descricao) values (%s, %s, 'P1', 'Marca X', 'Modelo Y', 'Produto') returning id",
        emp,
        cat,
    )[0][0]
    usuario = _admin(
        "insert into core.usuarios (email, nome, email_verificado_em) values (%s, 'Aprovador', now()) returning id",
        f"pp-{uuid.uuid4().hex[:8]}@exemplo.test",
    )[0][0]
    _admin(
        "insert into priv.analises_item (empresa_id, participacao_id, produto_id, resumo, aprovado_por, aprovado_em, aprovado_resumo) values (%s, %s, %s, 'COMPATÍVEL', %s, now(), 'COMPATÍVEL')",
        emp, part, prod, usuario,
    )  # fmt: skip
    _admin(
        "insert into priv.precificacoes (empresa_id, participacao_id, produto_id, quantidade, calculado_em, preco_final_unit, total_proposta, aprovado_por, aprovado_em) "
        "values (%s, %s, %s, 10, now(), 125, 1250, %s, now())",
        emp, part, prod, usuario,
    )  # fmt: skip
    conteudo = json.dumps(
        [{"participacao_id": str(part), "numero_item": 1, "descricao": "Veículo utilitário", "quantidade": "10.0000", "valor_unitario": "125.000000", "valor_total": "1250.0000",
          "produto_id": str(prod), "marca": "Marca X", "modelo": "Modelo Y", "casas": 2}]
    )  # fmt: skip
    prop = _admin(
        "insert into priv.propostas (empresa_id, acompanhamento_id, versao, representante_id, validade_dias, prazo_entrega_dias, garantia_meses, condicoes, local_assinatura, conteudo, total) "
        "values (%s, %s, 1, %s, 60, 30, 12, 'Pagamento em 30 dias', 'Curitiba', %s::jsonb, 1250) returning id",
        emp, ac, rep, conteudo,
    )[0][0]  # fmt: skip
    conn = psycopg.connect(os.environ["VV_ADMIN_URL_TEST"])
    conn.execute("set role vv_worker")
    conn.commit()
    yield {
        "conn": conn,
        "emp": emp,
        "prop": str(prop),
        "part": str(part),
        "rep": rep,
        "s3": S3Falso(),
    }
    conn.close()
    _admin("alter table priv.propostas disable trigger propostas_final_imutavel")
    _admin("delete from priv.propostas")
    _admin("delete from priv.precificacoes")
    _admin("delete from priv.analises_item")
    _admin("delete from priv.participacoes")
    _admin("delete from priv.acompanhamentos")
    _admin("delete from priv.produtos")
    _admin("alter table priv.propostas enable trigger propostas_final_imutavel")
    _admin("alter table core.empresas disable trigger user")
    _admin("delete from core.representante_poderes where representante_id = %s", rep)
    _admin("delete from core.representantes where id = %s", rep)
    _admin("delete from core.empresas where id = %s", emp)
    _admin("alter table core.empresas enable trigger user")
    _admin("delete from core.usuarios where id = %s", usuario)


def _prop(c: dict[str, Any]) -> Any:
    return _admin(
        "select status, bloqueada, validacao, total_extenso, arquivo_chave, arquivo_sha256 from priv.propostas where id = %s",
        c["prop"],
    )[0]


def _roda(c: dict[str, Any]) -> str | None:
    return gerar_proposta(c["conn"], c["prop"], c["s3"], HOJE, c["emp"])


def test_valida_sem_divergencia_e_grava_o_extenso(cena: Any) -> None:
    assert _roda(cena) == "rascunho"
    status, bloqueada, validacao, extenso, chave, _ = _prop(cena)
    assert (status, bloqueada, chave) == ("rascunho", False, None)
    assert [v for v in validacao if v["bloqueia"]] == []
    assert extenso == "mil duzentos e cinquenta reais"


def test_aprovada_gera_docx_com_hash_e_bloqueia(cena: Any) -> None:
    _roda(cena)
    _admin(
        "update priv.propostas set status = 'aprovada', aprovado_por = (select id from core.usuarios limit 1), aprovado_em = now() where id = %s",
        cena["prop"],
    )
    assert _roda(cena) == "final"
    status, _, _, _, chave, sha = _prop(cena)
    assert (
        status == "final"
        and chave
        == f"propostas/{cena['emp']}/{_admin('select acompanhamento_id from priv.propostas where id = %s', cena['prop'])[0][0]}/proposta-v1.docx"
    )
    dados = cena["s3"].objetos[chave]
    assert hashlib.sha256(dados).hexdigest() == sha
    xml = zipfile.ZipFile(io.BytesIO(dados)).read("word/document.xml").decode()
    assert (
        "mil duzentos e cinquenta reais" in xml
        and "Proposta Teste Ltda" in xml
        and "12/2026" in xml
        and "R$ 125,00" in xml
        and "Maria Representante" in xml
    )
    with pytest.raises(psycopg.errors.InsufficientPrivilege):  # final é imutável até para o worker
        _admin("update priv.propostas set total = 1 where id = %s", cena["prop"])
    assert _roda(cena) == "final"  # idempotente: não regrava
    assert len(cena["s3"].objetos) == 1


def test_preco_que_mudou_depois_da_aprovacao_devolve_a_rascunho(cena: Any) -> None:
    _admin(
        "update priv.propostas set status = 'aprovada', aprovado_por = (select id from core.usuarios limit 1), aprovado_em = now() where id = %s",
        cena["prop"],
    )
    _admin(
        "update priv.precificacoes set preco_final_unit = 130, total_proposta = 1300 where participacao_id = %s",
        cena["part"],
    )
    assert _roda(cena) == "rascunho"
    status, bloqueada, validacao, *_resto = _prop(cena)
    assert (
        status == "rascunho"
        and bloqueada is True
        and any(v["codigo"] == "preco_mudou" for v in validacao)
    )
    assert cena["s3"].objetos == {}  # nada foi gerado
    assert (
        _admin("select aprovado_em from priv.propostas where id = %s", cena["prop"])[0][0] is None
    )


def test_representante_sem_poder_e_documento_vencido_bloqueiam(cena: Any) -> None:
    _admin("delete from core.representante_poderes where representante_id = %s", cena["rep"])
    tipo = _admin("select id from pub.tipos_documento limit 1")[0][0]
    doc = _admin(
        "insert into priv.documentos (empresa_id, tipo_id, descricao) values (%s, %s, 'CND Federal') returning id",
        cena["emp"],
        tipo,
    )[0][0]
    _admin(
        "insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, validade, status_arquivo) values (%s, %s, 1, 'k/1', 'a.pdf', '2026-12-01', 'liberado')",
        doc, cena["emp"],
    )  # fmt: skip
    _roda(cena)
    _, bloqueada, validacao, *_resto = _prop(cena)
    assert bloqueada is True
    codigos = {v["codigo"] for v in validacao if v["bloqueia"]}
    assert {"representante", "documento_vencido"} <= codigos
    _admin("delete from priv.documentos where id = %s", doc)


def test_proposta_de_outra_empresa_e_ignorada(cena: Any) -> None:
    assert gerar_proposta(cena["conn"], cena["prop"], cena["s3"], HOJE, str(uuid.uuid4())) is None
    assert _prop(cena)[3] is None


def test_final_gera_o_pdf_e_pedir_depois_converte_so_se_faltar(cena: Any) -> None:
    _roda(cena)
    _admin(
        "update priv.propostas set status = 'aprovada', aprovado_por = (select id from core.usuarios limit 1), aprovado_em = now() where id = %s",
        cena["prop"],
    )
    with patch(
        "worker.proposta.docx_para_pdf",
        side_effect=PdfIndisponivel("sem soffice"),
    ):
        assert _roda(cena) == "final"  # sem LibreOffice: o final vale, só não há PDF
    assert (
        _admin("select arquivo_pdf_chave from priv.propostas where id = %s", cena["prop"])[0][0]
        is None
    )
    with patch("worker.proposta.docx_para_pdf", return_value=b"%PDF-1.7 teste"):
        assert _roda(cena) == "final"  # pedir o PDF depois grava só o PDF
    chave, sha = _admin(
        "select arquivo_pdf_chave, arquivo_pdf_sha256 from priv.propostas where id = %s",
        cena["prop"],
    )[0]
    assert chave.endswith("proposta-v1.pdf") and cena["s3"].objetos[chave] == b"%PDF-1.7 teste"
    assert sha == hashlib.sha256(b"%PDF-1.7 teste").hexdigest()
    with patch("worker.proposta.docx_para_pdf") as conv:
        _roda(cena)
        conv.assert_not_called()  # já tem PDF: nada a fazer
