"""Job analisar_item com banco (VV_ADMIN_URL_TEST): a classificação é do código, evidência verificada, aprovação cai."""

import os
import uuid
from typing import Any

import psycopg
import pytest

from tests.test_coleta import _admin
from worker.analise import analisar

pytestmark = pytest.mark.skipif(
    not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste"
)
TEXTO = (
    "O veículo deverá ter potência mínima de 100 cv, câmbio automá-\ntico e garantia de 36 meses."
)


@pytest.fixture
def cena() -> Any:
    assert _admin("select current_database()")[0][0] != "vv"
    emp = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, 'Análise Teste', '11222333000181')",
        emp,
    )
    usuario = _admin(
        "insert into core.usuarios (email, nome, email_verificado_em) values (%s, 'Analista', now()) returning id",
        f"an-{uuid.uuid4().hex[:8]}@exemplo.test",
    )[0][0]
    fonte = _admin("select id from ops.fontes where slug = 'pncp'")[0][0]
    org = _admin(
        "insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values (%s, 'Órgão', 'PR', '4106902') returning id",
        f"{uuid.uuid4().int % 10**14:014d}",
    )[0][0]
    ed = _admin(
        "insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) values (%s, %s, %s, 'x', repeat('a', 64)) returning id",
        fonte, f"AN-{uuid.uuid4()}", org,
    )[0][0]  # fmt: skip
    item = _admin(
        "insert into pub.edital_itens (edital_id, numero_item, descricao) values (%s, 1, 'Veículo') returning id",
        ed,
    )[0][0]
    arq = _admin(
        "insert into pub.edital_arquivos (edital_id, url_origem, titulo) values (%s, 'https://exemplo.test/tr.pdf', 'TR') returning id",
        ed,
    )[0][0]
    _admin(
        "insert into pub.trechos (edital_id, arquivo_id, pagina, texto) values (%s, %s, 7, %s)",
        ed,
        arq,
        TEXTO,
    )
    ac = _admin(
        "insert into priv.acompanhamentos (empresa_id, edital_id) values (%s, %s) returning id",
        emp,
        ed,
    )[0][0]
    part = _admin(
        "insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values (%s, %s, %s) returning id",
        emp,
        ac,
        item,
    )[0][0]
    cat = _admin("select id from pub.categorias where slug = 'veiculos'")[0][0]
    attr = _admin(
        "select id from pub.atributos_def where categoria_id = %s and tipo = 'numero' and grandeza = 'potencia' limit 1",
        cat,
    )
    prod = _admin(
        "insert into priv.produtos (empresa_id, categoria_id, codigo_interno, descricao, garantia_meses) values (%s, %s, 'P1', 'Produto', 36) returning id",
        emp, cat,
    )[0][0]  # fmt: skip
    if attr:
        kw = _admin("select id from pub.unidades where simbolo = 'kW'")[0][0]
        _admin(
            "insert into priv.produto_atributos (produto_id, empresa_id, atributo_id, valor_numero, unidade_id) values (%s, %s, %s, 85, %s)",
            prod, emp, attr[0][0], kw,
        )  # fmt: skip
    cv = _admin("select id from pub.unidades where simbolo = 'cv'")[0][0]
    meses = _admin("select id from pub.unidades where simbolo = 'meses'")[0][0]
    analise = _admin(
        "insert into priv.analises_item (empresa_id, participacao_id, produto_id) values (%s, %s, %s) returning id",
        emp,
        part,
        prod,
    )[0][0]
    conn = psycopg.connect(os.environ["VV_ADMIN_URL_TEST"])
    conn.execute("set role vv_worker")
    conn.commit()
    yield {
        "conn": conn,
        "emp": emp,
        "part": str(part),
        "analise": str(analise),
        "attr": attr[0][0] if attr else None,
        "cv": cv,
        "meses": meses,
        "usuario": usuario,
        "prod": prod,
    }
    conn.close()
    _admin("delete from priv.analise_linhas")
    _admin("delete from priv.analises_item")
    _admin("delete from priv.requisitos_item")
    _admin("delete from priv.participacoes")
    _admin("delete from priv.acompanhamentos")
    _admin("delete from priv.produto_atributos")
    _admin("delete from priv.produtos")
    _admin("delete from priv.documento_trechos")
    _admin("delete from priv.documento_versoes")
    _admin("delete from priv.documentos")
    _admin("alter table core.empresas disable trigger user")
    _admin("delete from core.empresas where id = %s", emp)
    _admin("alter table core.empresas enable trigger user")
    _admin("delete from core.usuarios where id = %s", usuario)


def _req(c: dict[str, Any], nome: str, **kw: Any) -> str:
    return str(
        _admin(
            "insert into priv.requisitos_item (empresa_id, participacao_id, nome, tipo_exigencia, atributo_id, operador, valor_numero, valor_texto, "
            "unidade_id, obrigatorio, citacao_edital, pagina) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
            c["emp"],
            c["part"],
            nome,
            kw.get("tipo", "minimo"),
            kw.get("atributo"),
            kw.get("op", ">="),
            kw.get("numero"),
            kw.get("texto"),
            kw.get("unidade"),
            kw.get("obrigatorio", True),
            kw.get("citacao"),
            kw.get("pagina"),
        )[0][0]
    )


def _linha(c: dict[str, Any], req: str) -> Any:
    return _admin(
        "select resultado, citacao_verificada, pagina_edital, valor_oferecido, pendencia from priv.analise_linhas where requisito_id = %s",
        req,
    )[0]


def _resumo(c: dict[str, Any]) -> str:
    return str(_admin("select resumo from priv.analises_item where id = %s", c["analise"])[0][0])


def test_potencia_insuficiente_reprova_o_item_mesmo_sem_nenhuma_evidencia(cena: Any) -> None:
    if cena["attr"] is None:
        pytest.skip("catálogo sem atributo de potência")
    r = _req(
        cena,
        "Potência",
        atributo=cena["attr"],
        numero=150,
        unidade=cena["cv"],
        citacao="citação que não existe no edital",
        pagina=7,
    )
    assert (
        analisar(cena["conn"], cena["analise"], cena["emp"]) == "REPROVADO"
    )  # 150 cv = 110 kW > 85 kW
    assert _linha(cena, r)[0] == "NÃO ATENDE"


def test_atende_so_com_citacao_verificada_e_ficha_conferida(cena: Any) -> None:
    if cena["attr"] is None:
        pytest.skip("catálogo sem atributo de potência")
    # 100 cv = 73,5 kW; o produto tem 85 kW: cumpre.
    r = _req(
        cena,
        "Potência",
        atributo=cena["attr"],
        numero=100,
        unidade=cena["cv"],
        citacao="potência mínima de 100 cv",
        pagina=7,
    )
    assert analisar(cena["conn"], cena["analise"], cena["emp"]) == "PENDENTE"
    res, citacao_ok, pagina, oferecido, pendencia = _linha(cena, r)
    assert (res, citacao_ok, pagina, oferecido) == ("A CONFIRMAR", True, 7, "85 kW")
    assert "ficha técnica" in pendencia  # falta a pessoa conferir a ficha
    doc = _admin(
        "insert into priv.documentos (empresa_id, tipo_id, descricao) values (%s, (select id from pub.tipos_documento limit 1), 'Ficha') returning id",
        cena["emp"],
    )[0][0]
    _admin(
        "update priv.analise_linhas set ficha_documento_id = %s, ficha_pagina = 2, ficha_trecho = 'Potência máx.: 85 kW', ficha_conferida_por = %s, ficha_conferida_em = now() where requisito_id = %s",
        doc, cena["usuario"], r,
    )  # fmt: skip
    assert analisar(cena["conn"], cena["analise"], cena["emp"]) == "COMPATÍVEL"
    assert _linha(cena, r)[0] == "ATENDE"


def test_citacao_inexistente_rebaixa_para_a_confirmar(cena: Any) -> None:
    if cena["attr"] is None:
        pytest.skip("catálogo sem atributo de potência")
    r = _req(
        cena,
        "Potência",
        atributo=cena["attr"],
        numero=100,
        unidade=cena["cv"],
        citacao="potência mínima de 300 cv",
        pagina=7,
    )
    _ = analisar(cena["conn"], cena["analise"], cena["emp"])
    res, citacao_ok, pagina, *_resto = _linha(cena, r)
    assert (res, citacao_ok, pagina) == ("A CONFIRMAR", False, None)


def test_garantia_vem_do_cadastro_do_produto_e_nao_atende_quando_menor(cena: Any) -> None:
    r = _req(
        cena,
        "Garantia",
        tipo="garantia",
        numero=48,
        unidade=cena["meses"],
        citacao="garantia de 36 meses",
    )
    assert (
        analisar(cena["conn"], cena["analise"], cena["emp"]) == "REPROVADO"
    )  # produto tem 36 meses, edital pede 48
    assert _linha(cena, r)[0] == "NÃO ATENDE"


def test_requisito_sem_atributo_vinculado_fica_a_confirmar_com_pendencia(cena: Any) -> None:
    r = _req(cena, "Cor", tipo="outro", op="contem", texto="branca")
    assert analisar(cena["conn"], cena["analise"], cena["emp"]) == "PENDENTE"
    res, *_x, pendencia = _linha(cena, r)
    assert res == "A CONFIRMAR" and "Vincule" in pendencia


def test_opcional_nao_reprova_e_sem_requisito_obrigatorio_fica_pendente(cena: Any) -> None:
    _req(
        cena,
        "Garantia estendida",
        tipo="garantia",
        numero=48,
        unidade=cena["meses"],
        obrigatorio=False,
    )
    assert (
        analisar(cena["conn"], cena["analise"], cena["emp"]) == "PENDENTE"
    )  # só opcionais: sem obrigatório cadastrado


def test_mudar_o_resultado_derruba_a_aprovacao_e_job_de_outra_empresa_e_ignorado(cena: Any) -> None:
    _req(
        cena,
        "Garantia",
        tipo="garantia",
        numero=24,
        unidade=cena["meses"],
        citacao="garantia de 36 meses",
        pagina=7,
    )
    assert (
        analisar(cena["conn"], cena["analise"], cena["emp"]) == "PENDENTE"
    )  # cumpre, mas falta conferir a ficha
    _admin(
        "update priv.analises_item set aprovado_por = %s, aprovado_em = now(), aprovado_resumo = 'PENDENTE' where id = %s",
        cena["usuario"],
        cena["analise"],
    )
    analisar(cena["conn"], cena["analise"], cena["emp"])  # nada mudou: aprovação segue
    assert (
        _admin("select aprovado_por from priv.analises_item where id = %s", cena["analise"])[0][0]
        == cena["usuario"]
    )
    _admin(
        "update priv.produtos set garantia_meses = 12 where id = %s", cena["prod"]
    )  # agora NÃO ATENDE
    assert analisar(cena["conn"], cena["analise"], cena["emp"]) == "REPROVADO"
    assert (
        _admin("select aprovado_por from priv.analises_item where id = %s", cena["analise"])[0][0]
        is None
    )
    assert (
        analisar(cena["conn"], cena["analise"], str(uuid.uuid4())) is None
    )  # empresa do job diferente: nada é feito


def test_citacao_da_ficha_privada_conferida_automaticamente_no_texto_extraido(cena: Any) -> None:
    if cena["attr"] is None:
        pytest.skip("catálogo sem atributo de potência")
    r = _req(
        cena,
        "Potência",
        atributo=cena["attr"],
        numero=100,
        unidade=cena["cv"],
        citacao="potência mínima de 100 cv",
        pagina=7,
    )
    doc = _admin(
        "insert into priv.documentos (empresa_id, tipo_id, descricao) values (%s, (select id from pub.tipos_documento limit 1), 'Ficha Oficial') returning id",
        cena["emp"],
    )[0][0]
    ver = _admin(
        "insert into priv.documento_versoes (empresa_id, documento_id, versao, arquivo_chave, nome_original, status_arquivo) "
        "values (%s, %s, 1, 'documentos/ficha.pdf', 'ficha.pdf', 'liberado') returning id",
        cena["emp"],
        doc,
    )[0][0]
    _admin(
        "insert into priv.documento_trechos (empresa_id, documento_id, versao_id, pagina, ordem, texto) values (%s, %s, %s, 2, 1, 'Potência máx.: 85 kW a 3.500 rpm')",
        cena["emp"],
        doc,
        ver,
    )
    assert analisar(cena["conn"], cena["analise"], cena["emp"]) == "PENDENTE"
    # Trecho que NÃO existe na ficha extraída: rebaixa para A CONFIRMAR mesmo com ficha_conferida_por preenchido
    _admin(
        "update priv.analise_linhas set ficha_documento_id = %s, ficha_pagina = 2, ficha_trecho = 'Potência máx.: 999 kW', "
        "ficha_conferida_por = %s, ficha_conferida_em = now() where requisito_id = %s",
        doc,
        cena["usuario"],
        r,
    )
    assert analisar(cena["conn"], cena["analise"], cena["emp"]) == "PENDENTE"
    res, f_verificada = _admin(
        "select resultado, ficha_citacao_verificada from priv.analise_linhas where requisito_id = %s",
        r,
    )[0]
    assert (res, f_verificada) == ("A CONFIRMAR", False)

    # Trecho que existe na página 2 da ficha extraída: ATENDE e ficha_citacao_verificada = True
    _admin(
        "update priv.analise_linhas set ficha_trecho = 'Potência máx.: 85 kW' where requisito_id = %s",
        r,
    )
    assert analisar(cena["conn"], cena["analise"], cena["emp"]) == "COMPATÍVEL"
    res, f_verificada = _admin(
        "select resultado, ficha_citacao_verificada from priv.analise_linhas where requisito_id = %s",
        r,
    )[0]
    assert (res, f_verificada) == ("ATENDE", True)
    pos, rotulo = _admin(
        "select posicao_alternativa, rotulo_alternativa from priv.analises_item where id = %s",
        cena["analise"],
    )[0]
    assert (pos, rotulo) == (1, "melhor_compativel")
