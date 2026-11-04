"""Coleta ponta a ponta com a API falsa (fixtures reais) e o banco de teste (VV_ADMIN_URL_TEST).
Age como vv_worker (`set role`); limpa o que criou. Nunca roda no banco `vv`."""

import copy
import os
from datetime import UTC, datetime
from typing import Any

import psycopg
import pytest

from tests.test_pncp import FakeHttp
from worker.pesquisa.coleta import coletar
from worker.pesquisa.http import ErroTransitorio

ADMIN = os.environ.get("VV_ADMIN_URL_TEST", "")
pytestmark = pytest.mark.skipif(not ADMIN, reason="sem banco de teste")
AGORA = datetime(2026, 11, 4, 7, 5, tzinfo=UTC)


def _admin(sql: str, *args: Any) -> list[tuple[Any, ...]]:
    with psycopg.connect(ADMIN, autocommit=True) as c:
        cur = c.execute(sql, args or None)
        return cur.fetchall() if cur.description else []


def _limpar() -> None:
    assert _admin("select current_database()")[0][0] != "vv"
    _admin("alter table pub.edital_versoes disable trigger edital_versoes_imutavel")
    _admin("alter table pub.edital_eventos disable trigger edital_eventos_imutavel")
    _admin("alter table core.notificacoes disable trigger user")
    _admin(
        "truncate pub.edital_eventos, pub.edital_versoes, pub.trechos, pub.edital_arquivos, "
        "pub.edital_itens, pub.editais, pub.orgaos, ops.execucoes, ops.fonte_checagens cascade"
    )
    _admin(
        "delete from ops.jobs where tipo in ('coletar_fonte','baixar_arquivo_edital','avaliar_relevancia','email_operacional','extrair_texto','indexar_trechos')"
    )
    _admin("delete from core.notificacoes where tipo = 'pesquisa_alerta'")
    _admin("alter table core.notificacoes enable trigger user")
    _admin("alter table pub.edital_versoes enable trigger edital_versoes_imutavel")
    _admin("alter table pub.edital_eventos enable trigger edital_eventos_imutavel")
    _admin(
        "update ops.fontes set ativa = false, status = 'desativada', falhas_consecutivas = 0, ultimo_sucesso_em = null where slug = 'pncp'"
    )


@pytest.fixture
def conn() -> Any:
    _limpar()
    _admin("update ops.fontes set ativa = true, status = 'ok' where slug = 'pncp'")
    c = psycopg.connect(ADMIN)
    c.execute("set role vv_worker")
    c.commit()
    yield c
    c.close()
    _limpar()


def _execucao(tipo: str = "manual") -> str:
    r = _admin(
        "insert into ops.execucoes (fonte_id, tipo, agendada_para, status, detalhe, janela_ini, janela_fim) "
        "select id, %s, now() + (random() * interval '1 day'), 'agendada', '{}', '2026-11-01', '2026-11-05' "
        "from ops.fontes where slug = 'pncp' returning id",
        tipo,
    )
    return str(r[0][0])


def _n(sql: str) -> int:
    return int(_admin(sql)[0][0])


class HttpRetificado(FakeHttp):
    """Mesma compra de 8 itens, agora retificada: nova data, nova atualização na fonte, um item a menos."""

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        r = super().get_json(url, params)
        if r and "/publicacao" in url:
            r = copy.deepcopy(r)
            c = r["data"][1]
            c["dataEncerramentoProposta"] = "2026-12-01T09:00:00"
            c["dataAtualizacaoGlobal"] = "2026-11-05T08:00:00"
        elif r and url.endswith("/itens") and "/compras/2026/484/" in url:
            r = r[:-1]
        return r


def test_oito_itens_viram_oito_registros_e_repetir_nao_duplica(conn: Any) -> None:
    assert coletar(conn, _execucao(), FakeHttp(), AGORA) == "ok"
    assert _n("select count(*) from pub.editais") == 2
    assert (
        _n(
            "select count(*) from pub.edital_itens i join pub.editais e on e.id = i.edital_id where e.id_externo like '80257355000108%'"
        )
        == 8
    )
    assert _n("select count(*) from pub.edital_arquivos") == 2
    assert _n("select count(*) from pub.edital_versoes") == 2
    # Segunda coleta (outra execução, mesmo dado): nada duplica nem cria versão.
    assert coletar(conn, _execucao(), FakeHttp(), AGORA) == "ok"
    assert _n("select count(*) from pub.editais") == 2
    assert _n("select count(*) from pub.edital_itens") == 9
    assert _n("select count(*) from pub.edital_versoes") == 2
    ex = _admin(
        "select processos_encontrados, editais_novos, status from ops.execucoes order by created_at"
    )
    assert [tuple(x) for x in ex] == [(2, 2, "ok"), (2, 0, "ok")]
    assert _n("select count(*) from ops.jobs where tipo = 'avaliar_relevancia'") == 2


def test_retificacao_cria_versao_evento_e_item_retirado(conn: Any) -> None:
    coletar(conn, _execucao(), FakeHttp(), AGORA)
    coletar(conn, _execucao(), HttpRetificado(), AGORA)
    e = _admin(
        "select versao_atual, data_encerramento_propostas::text from pub.editais where id_externo like '80257355000108%'"
    )
    assert e[0][0] == 2 and e[0][1].startswith("2026-12-01")
    v = _admin("select campos_alterados from pub.edital_versoes where versao = 2")
    assert "data_encerramento_propostas" in v[0][0] and "itens" in v[0][0]
    ev = {r[0] for r in _admin("select tipo from pub.edital_eventos where versao = 2")}
    assert {"retificado", "data_alterada"} <= ev
    assert (
        _n("select count(*) from pub.edital_itens where versao_final = 2") == 1
    )  # retirado, não apagado
    assert (
        _n(
            "select count(*) from pub.edital_itens i join pub.editais e on e.id = i.edital_id where e.id_externo like '80257355000108%'"
        )
        == 8
    )


def test_registro_malformado_e_isolado_e_a_coleta_fica_parcial(conn: Any) -> None:
    class Http(FakeHttp):
        def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
            r = super().get_json(url, params)
            if r and "/publicacao" in url:
                r = copy.deepcopy(r)
                del r["data"][0]["orgaoEntidade"]  # registro quebrado
            return r

    assert coletar(conn, _execucao(), Http(), AGORA) == "parcial"
    assert _n("select count(*) from pub.editais") == 1  # o outro registro entrou
    assert _admin("select status, itens_pendentes from ops.execucoes")[0] == ("parcial", 1)
    assert _admin("select status from ops.fontes where slug = 'pncp'")[0][0] == "degradada"


def test_falha_da_fonte_registra_e_so_a_ultima_tentativa_conta(conn: Any) -> None:
    class Fora(FakeHttp):
        def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
            raise ErroTransitorio("http 503")

    for ultima in (False, True, True, True):
        with pytest.raises(ErroTransitorio):
            coletar(conn, _execucao(), Fora(), AGORA, ultima_tentativa=ultima)
    f = _admin("select status, falhas_consecutivas from ops.fontes where slug = 'pncp'")[0]
    assert f == ("indisponivel", 3)  # a tentativa intermediária não contou
    assert _n("select count(*) from ops.execucoes where status = 'falhou'") == 4
    assert _n("select count(*) from ops.fonte_checagens where not ok") == 4
    assert _n("select count(*) from pub.editais") == 0  # nunca vira "nenhum edital" por engano
    # Sucesso depois da falha zera o contador e a fonte volta a ok.
    assert coletar(conn, _execucao(), FakeHttp(), AGORA) == "ok"
    assert _admin("select status, falhas_consecutivas from ops.fontes where slug = 'pncp'")[0] == (
        "ok",
        0,
    )
