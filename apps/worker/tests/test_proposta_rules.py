import io
import zipfile
from datetime import date
from decimal import Decimal as D
from xml.etree import ElementTree as ET

from worker.docx import montar, paragrafo, tabela
from worker.rules.proposta import Dados, ItemProposta, bloqueada, validar


def item(**kw: object) -> ItemProposta:
    base: dict[str, object] = {
        "numero_item": 1, "quantidade": D(10), "valor_unitario": D("125.00"), "valor_total": D("1250.00"), "quantidade_edital": D(10),
        "valor_estimado_unit": D("200.00"), "preco_aprovado_unit": D("125.00"), "tem_produto": True, "analise_aprovada": True, "marca_modelo": "Marca X",
    }  # fmt: skip
    base.update(kw)
    return ItemProposta(**base)  # type: ignore[arg-type]


def dados(**kw: object) -> Dados:
    base: dict[str, object] = {
        "cnpj_valido": True, "razao_social": "Empresa Ltda", "numero_edital": "12/2026", "representante_valido": True, "data_sessao": date(2026, 12, 16),
        "sessao_confirmada": True, "itens": (item(),), "total_proposta": D("1250.00"), "documentos_vencidos": (), "validade_dias": 60,
        "prazo_entrega_dias": 30, "garantia_meses": 12,
    }  # fmt: skip
    base.update(kw)
    return Dados(**base)  # type: ignore[arg-type]


def codigos(d: Dados) -> set[str]:
    return {x.codigo for x in validar(d) if x.bloqueia}


def test_proposta_correta_nao_tem_divergencia_bloqueante() -> None:
    r = validar(dados())
    assert r == [] and bloqueada(r) is False


def test_cada_divergencia_da_8_6_bloqueia() -> None:
    assert "cnpj" in codigos(dados(cnpj_valido=False))
    assert "razao_social" in codigos(dados(razao_social=None))
    assert "numero_edital" in codigos(dados(numero_edital=None))
    assert "representante" in codigos(dados(representante_valido=False))
    assert "sessao" in codigos(dados(data_sessao=None))
    assert "itens" in codigos(dados(itens=(), total_proposta=D(0)))
    assert "quantidade" in codigos(dados(itens=(item(quantidade_edital=D(12)),)))
    assert "total_item" in codigos(
        dados(itens=(item(valor_total=D("1249.99")),), total_proposta=D("1249.99"))
    )
    assert "total" in codigos(dados(total_proposta=D("1300.00")))
    assert "analise_tecnica" in codigos(dados(itens=(item(analise_aprovada=False),)))
    assert "produto" in codigos(dados(itens=(item(tem_produto=False),)))
    assert "preco_sem_aprovacao" in codigos(dados(itens=(item(preco_aprovado_unit=None),)))
    assert "preco_mudou" in codigos(dados(itens=(item(preco_aprovado_unit=D("120.00")),)))
    assert "documento_vencido" in codigos(dados(documentos_vencidos=("CND Federal",)))
    for campo, codigo in (
        ("validade_dias", "validade"),
        ("prazo_entrega_dias", "prazo_entrega"),
        ("garantia_meses", "garantia"),
    ):
        assert codigo in codigos(dados(**{campo: None}))
        assert codigo in codigos(dados(**{campo: 0}))


def test_avisos_nao_bloqueiam() -> None:
    r = validar(
        dados(
            sessao_confirmada=False,
            itens=(
                item(
                    valor_unitario=D("250.00"),
                    valor_total=D("2500.00"),
                    preco_aprovado_unit=D("250.00"),
                ),
            ),
            total_proposta=D("2500.00"),
        )
    )
    assert {x.codigo for x in r} == {"sessao_provisoria", "acima_do_estimado"}
    assert bloqueada(r) is False


def test_quantidade_do_edital_ausente_nao_bloqueia() -> None:
    assert validar(dados(itens=(item(quantidade_edital=None),))) == []


def test_total_do_item_usa_arredondamento_de_centavos() -> None:
    it = item(
        quantidade=D("3"),
        valor_unitario=D("33.33"),
        valor_total=D("99.99"),
        quantidade_edital=D("3"),
        preco_aprovado_unit=D("33.33"),
    )
    assert validar(dados(itens=(it,), total_proposta=D("99.99"))) == []


def test_docx_e_um_zip_valido_com_texto_escapado() -> None:
    doc = montar(
        [
            paragrafo("PROPOSTA <b>COMERCIAL</b> & Cia", negrito=True, tamanho=14, centro=True),
            tabela(["Item", "Total"], [["1", "R$ 10,00\x00"]]),
        ]
    )
    z = zipfile.ZipFile(io.BytesIO(doc))
    assert set(z.namelist()) == {"[Content_Types].xml", "_rels/.rels", "word/document.xml"}
    raiz = ET.fromstring(
        z.read("word/document.xml")
    )  # XML bem formado (texto de edital não vira marcação)
    textos = [
        t.text for t in raiz.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")
    ]
    assert "PROPOSTA <b>COMERCIAL</b> & Cia" in textos
    assert "R$ 10,00" in textos  # caractere de controle removido
