"""Chave de IA por empresa: decifrar (vetores compartilhados), resolver o cliente e testar a chave, com banco (VV_ADMIN_URL_TEST)."""

import base64
import json
import os
import uuid
from pathlib import Path
from typing import Any

import psycopg
import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pydantic import SecretStr

import worker.chave_ia as ci
from tests.test_coleta import _admin
from worker.chave_ia import cliente_da_empresa
from worker.cripto import ErroDecifrar, _kek, contexto_chave_ia, decifrar
from worker.llm.extracao_requisitos import Anthropic, ErroLLM
from worker.settings import Settings

VETORES: dict[str, Any] = json.loads(
    (
        Path(__file__).resolve().parents[3] / "docs" / "referencia" / "cifra-campo-vetores.json"
    ).read_text(encoding="utf-8")
)
KEK = "k" * 40


def cifrar(texto: str, contexto: str, segredo: str = KEK) -> dict[str, Any]:
    dek, iv, iv_dek = os.urandom(32), os.urandom(12), os.urandom(12)
    ct = AESGCM(dek).encrypt(iv, texto.encode(), f"dado|{contexto}".encode())
    dek_c = iv_dek + AESGCM(_kek(segredo)).encrypt(iv_dek, dek, f"dek|{contexto}".encode())
    return {
        "v": 1,
        "dek": base64.b64encode(dek_c).decode(),
        "iv": base64.b64encode(iv).decode(),
        "ct": base64.b64encode(ct).decode(),
    }


def test_decifra_o_envelope_gerado_pela_api() -> None:
    assert (
        decifrar(VETORES["envelope"], VETORES["segredo"], VETORES["contexto"]) == VETORES["texto"]
    )


def test_qualquer_problema_vira_o_mesmo_erro_sem_detalhe() -> None:
    env = VETORES["envelope"]
    for args in (
        (env, VETORES["segredo"], VETORES["contexto"].replace("0001", "0002")),  # outro contexto
        (env, "x" * 40, VETORES["contexto"]),  # outra KEK
        (env, "curta", VETORES["contexto"]),  # KEK curta demais
        ({**env, "v": 2}, VETORES["segredo"], VETORES["contexto"]),
        ({**env, "ct": "AAAA"}, VETORES["segredo"], VETORES["contexto"]),
        ({"v": 1}, VETORES["segredo"], VETORES["contexto"]),
    ):
        with pytest.raises(ErroDecifrar, match="Falha ao decifrar"):
            decifrar(*args)


def test_contexto_e_em_minusculas_como_na_api() -> None:
    assert contexto_chave_ia("ABC-123") == "priv.empresa_ia.chave|abc-123"


@pytest.fixture
def cena() -> Any:
    assert _admin("select current_database()")[0][0] != "vv"
    emp = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, 'Chave Teste', '11222333000181')",
        emp,
    )
    conn = psycopg.connect(os.environ["VV_ADMIN_URL_TEST"])
    conn.execute("set role vv_worker")
    conn.commit()
    yield {"conn": conn, "emp": emp}
    conn.close()
    _admin("delete from priv.empresa_ia")
    _admin("alter table core.empresas disable trigger user")
    _admin("delete from core.empresas where id = %s", emp)
    _admin("alter table core.empresas enable trigger user")


def _guardar(emp: str, chave: str, modelo: str | None = None, segredo: str = KEK) -> None:
    _admin(
        "insert into priv.empresa_ia (empresa_id, chave_cifrada, ultimos4, modelo) values (%s, %s::jsonb, %s, %s)",
        emp, json.dumps(cifrar(chave, contexto_chave_ia(emp), segredo)), chave[-4:], modelo,
    )  # fmt: skip


def _s(**kw: Any) -> Settings:
    return Settings(kek=SecretStr(KEK), **kw)


@pytest.mark.skipif(not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste")
def test_sem_chave_nenhuma_a_ia_fica_desligada_e_a_global_serve_de_reserva(cena: Any) -> None:
    assert cliente_da_empresa(cena["conn"], cena["emp"], _s()) is None
    reserva = cliente_da_empresa(
        cena["conn"], cena["emp"], _s(anthropic_api_key=SecretStr("sk-ant-global-0000"))
    )
    assert reserva is not None and reserva.modelo == "claude-sonnet-5-5"


@pytest.mark.skipif(not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste")
def test_chave_da_empresa_e_decifrada_com_o_modelo_escolhido_e_vale_mais_que_a_global(
    cena: Any,
) -> None:
    _guardar(cena["emp"], "sk-ant-api03-DA-EMPRESA-1234", "claude-haiku-5-5")
    c = cliente_da_empresa(
        cena["conn"], cena["emp"], _s(anthropic_api_key=SecretStr("sk-ant-global-0000"))
    )
    assert (
        isinstance(c, Anthropic)
        and c._chave == "sk-ant-api03-DA-EMPRESA-1234"
        and c.modelo == "claude-haiku-5-5"
    )


@pytest.mark.skipif(not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste")
def test_kek_trocada_ou_dado_de_outra_empresa_nao_decifra_e_vira_ia_desligada(cena: Any) -> None:
    _guardar(cena["emp"], "sk-ant-api03-X-9999", segredo="outra-chave-mestra-" + "z" * 30)
    assert cliente_da_empresa(cena["conn"], cena["emp"], _s()) is None
    _admin("delete from priv.empresa_ia")
    _admin(
        "insert into priv.empresa_ia (empresa_id, chave_cifrada, ultimos4) values (%s, %s::jsonb, '9999')",
        cena["emp"], json.dumps(cifrar("sk-ant-api03-X-9999", contexto_chave_ia(str(uuid.uuid4())))),
    )  # fmt: skip
    assert (
        cliente_da_empresa(cena["conn"], cena["emp"], _s()) is None
    )  # envelope copiado de outra empresa não abre


class ClienteFalso(Anthropic):
    def __init__(self, erro: str | None) -> None:
        super().__init__("x", "m")
        self.erro = erro

    def testar(self) -> None:
        if self.erro:
            raise ErroLLM(self.erro)


@pytest.mark.skipif(not os.environ.get("VV_ADMIN_URL_TEST"), reason="sem banco de teste")
def test_teste_da_chave_grava_ok_ou_falhou_e_ignora_pedido_de_outra_empresa(cena: Any) -> None:
    _guardar(cena["emp"], "sk-ant-api03-T-0000")
    emp = cena["emp"]

    def estado() -> Any:
        return _admin(
            "select teste_status, teste_erro, teste_em is not null from priv.empresa_ia where empresa_id = %s",
            emp,
        )[0]

    assert ci.testar_chave(
        cena["conn"], emp, emp, _s(), ClienteFalso(None)
    ) == "ok" and estado() == (
        "ok",
        None,
        True,
    )
    assert ci.testar_chave(
        cena["conn"], emp, emp, _s(), ClienteFalso("o provedor respondeu 401")
    ) == "falhou" and estado() == ("falhou", "o provedor respondeu 401", True)
    assert (
        ci.testar_chave(cena["conn"], emp, str(uuid.uuid4()), _s(), ClienteFalso(None)) is None
    )  # payload de outra empresa
