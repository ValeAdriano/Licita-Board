"""Conector PNCP e cliente HTTP, com fixtures gravadas da API real (2026-11-04): sem rede."""

import json
import urllib.error
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from worker.connectors.pncp import (
    ConectorPNCP,
    normalizar_arquivo,
    normalizar_compra,
    normalizar_item,
)
from worker.pesquisa.http import ClienteHttp, ErroPermanente, ErroTransitorio, host_permitido

FIX = Path(__file__).parent / "fixtures" / "pncp"


def carregar(nome: str) -> Any:
    return json.loads((FIX / nome).read_text(encoding="utf-8"), parse_float=Decimal)


class FakeHttp:
    """Serve as fixtures por URL; o resto devolve vazio (como o 204 da fonte)."""

    def __init__(self) -> None:
        self.chamadas: list[str] = []

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        self.chamadas.append(url)
        if "/publicacao" in url:
            ok = params and params["uf"] == "PR" and params["codigoModalidadeContratacao"] == 6
            return carregar("publicacao_p1.json") if ok else None
        if "/atualizacao" in url:
            return None
        seq = "298" if "/compras/2026/298/" in url else "484"
        return carregar(f"{'itens' if url.endswith('/itens') else 'arquivos'}_{seq}.json")


def test_compra_normalizada_com_link_oficial_e_sem_inventar_data_da_sessao() -> None:
    raw = carregar("publicacao_p1.json")["data"][0]
    c = normalizar_compra(raw)
    assert c.id_externo == "78200482000110-1-000298/2026"
    assert c.orgao.cnpj == "78200482000110" and c.orgao.esfera == "municipal" and c.orgao.uf == "PR"
    assert c.campos["link_origem"] == "https://pncp.gov.br/app/editais/78200482000110/2026/298"
    assert c.campos["valor_estimado"] == Decimal("177500.0000")
    assert c.campos["data_encerramento_propostas"].tzinfo is not None  # Brasília
    assert c.campos["data_sessao"] is None  # a fonte não informa; nada é deduzido


def test_edital_de_oito_itens_vira_oito_registros_com_beneficio_literal() -> None:
    raw = carregar("publicacao_p1.json")["data"][1]
    c = ConectorPNCP(FakeHttp()).detalhar(normalizar_compra(raw))
    assert len(c.itens) == 8
    assert len({i.numero_item for i in c.itens}) == 8
    assert {i.beneficio for i in c.itens} == {
        "exclusivo_me_epp",
        "cota_reservada",
        "ampla_concorrencia",
    }
    assert all(isinstance(i.quantidade, Decimal) for i in c.itens)  # dinheiro/quantidade sem float
    assert [a.tipo for a in c.arquivos] == ["edital"]


def test_beneficio_desconhecido_ou_nao_se_aplica_fica_nao_informado() -> None:
    base = carregar("itens_298.json")[0]
    assert normalizar_item({**base, "tipoBeneficio": 5}).beneficio == "nao_informado"
    assert normalizar_item({**base, "tipoBeneficio": 2}).beneficio == "nao_informado"
    assert normalizar_item({**base, "tipoBeneficio": None}).beneficio == "nao_informado"
    assert normalizar_item({**base, "tipoBeneficio": 1}).beneficio == "exclusivo_me_epp"


def test_orcamento_sigiloso_nao_guarda_valor() -> None:
    base = carregar("itens_298.json")[0]
    i = normalizar_item({**base, "orcamentoSigiloso": True})
    assert i.valor_unitario_estimado is None and i.valor_total_estimado is None


def test_hash_estavel_e_muda_com_retificacao() -> None:
    raw = carregar("publicacao_p1.json")["data"][0]
    a, b = normalizar_compra(raw), normalizar_compra(raw)
    assert a.hash() == b.hash()
    mudou = normalizar_compra({**raw, "dataEncerramentoProposta": "2026-11-20T09:00:00"})
    assert mudou.hash() != a.hash()


def test_arquivo_sem_https_ou_inativo_e_ignorado() -> None:
    raw = carregar("arquivos_298.json")[0]
    assert normalizar_arquivo({**raw, "url": "http://pncp.gov.br/x"}) is None
    assert normalizar_arquivo({**raw, "statusAtivo": False}) is None
    assert normalizar_arquivo(raw) is not None


def test_listagem_pagina_ate_o_total_e_aceita_resposta_vazia() -> None:
    http = FakeHttp()
    paginas = list(ConectorPNCP(http).listar("publicacao", "20261101", "20261104", "PR", 6))
    assert len(paginas) == 1 and len(paginas[0][0]) == 2
    assert list(ConectorPNCP(http).listar("publicacao", "20261101", "20261104", "SC", 6)) == [
        ([], {})
    ]


@pytest.mark.parametrize(
    ("url", "esperado"),
    [
        ("https://pncp.gov.br/api/x", True),
        ("https://api.pncp.gov.br/x", True),
        ("http://pncp.gov.br/x", False),
        ("https://pncp.gov.br.evil.test/x", False),
        ("https://evil.test/pncp.gov.br", False),
        ("https://127.0.0.1/x", False),
        ("https://user:senha@pncp.gov.br/x", False),
        ("https://pncp.gov.br:8443/x", False),
        ("file:///etc/passwd", False),
    ],
)
def test_host_permitido_bloqueia_ssrf(url: str, esperado: bool) -> None:
    assert host_permitido(url, ["pncp.gov.br"]) is esperado


class _Resp:
    def __init__(self, corpo: bytes) -> None:
        self._c = corpo

    def read(self, _n: int) -> bytes:
        return self._c

    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *a: object) -> None:
        return None


def _cliente(respostas: list[Any], dormidas: list[float]) -> ClienteHttp:
    c = ClienteHttp("VV-teste", ["pncp.gov.br"], 1000, dormir=dormidas.append, ultimo_por_host={})
    fila = iter(respostas)

    def abrir(*_a: Any, **_k: Any) -> Any:
        r = next(fila)
        if isinstance(r, Exception):
            raise r
        return r

    c._abridor.open = abrir  # type: ignore[method-assign]
    return c


def _http(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("https://pncp.gov.br/x", code, "x", {}, None)  # type: ignore[arg-type]


def test_retry_com_espera_progressiva_e_sucesso() -> None:
    dormidas: list[float] = []
    c = _cliente([_http(503), _http(429), _Resp(b'{"valor": 1.50}')], dormidas)
    r = c.get_json("https://pncp.gov.br/x")
    assert r == {"valor": Decimal("1.50")}  # float nunca
    assert [d for d in dormidas if d >= 1] == [1.0, 2.0]


def test_esgota_tentativas_vira_erro_transitorio() -> None:
    c = _cliente([_http(500)] * 4, [])
    with pytest.raises(ErroTransitorio):
        c.get_json("https://pncp.gov.br/x")


def test_4xx_e_redirecionamento_nao_repetem() -> None:
    with pytest.raises(ErroPermanente):
        _cliente([_http(400)], []).get_json("https://pncp.gov.br/x")
    with pytest.raises(ErroPermanente):
        _cliente([_http(302)], []).get_json("https://pncp.gov.br/x")
    with pytest.raises(ErroPermanente):
        _cliente([], []).get_json("https://evil.test/x")


def test_resposta_vazia_e_204() -> None:
    assert _cliente([_Resp(b"")], []).get_json("https://pncp.gov.br/x") is None


def test_taxa_vale_entre_clientes_do_mesmo_processo() -> None:
    agora = [100.0]
    dormidas: list[float] = []
    estado: dict[str, float] = {}

    def novo() -> ClienteHttp:
        c = ClienteHttp(
            "VV",
            ["pncp.gov.br"],
            2,
            dormir=dormidas.append,
            monotonico=lambda: agora[0],
            ultimo_por_host=estado,
        )
        c._abridor.open = lambda *_a, **_k: _Resp(b"{}")  # type: ignore[method-assign]
        return c

    novo().get_json("https://pncp.gov.br/a")
    novo().get_json("https://pncp.gov.br/b")  # outro cliente, mesmo instante: precisa esperar 0,5 s
    assert dormidas == [0.5]
