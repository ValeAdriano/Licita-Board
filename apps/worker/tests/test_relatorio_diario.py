"""Relatório diário (12.2): composição pura e, com banco (VV_ADMIN_URL_TEST/VV_DATABASE_URL_TEST), seções por permissão, fila idempotente e envio."""

import datetime as dt
import os
import uuid
from typing import Any

import psycopg
import pytest

from tests.test_coleta import _admin
from worker.email import Mensagem
from worker.fila import Handlers, processar_lote
from worker.relatorio_diario import Secao, coletar, compor, enfileirar
from worker.settings import Settings

HOJE = dt.date(2026, 11, 5)
AGORA = dt.datetime(2026, 11, 5, 11, 0, tzinfo=dt.UTC)  # 08:00 em Brasília


def test_compor_lista_as_secoes_sem_valor_financeiro_e_aponta_o_app() -> None:
    m = compor(
        "a@b.test",
        "Empresa X",
        [Secao("Pendências", ["2 proposta(s) pendente(s)."])],
        HOJE,
        "https://app.teste/",
    )
    assert m.assunto == "Relatório diário · Empresa X · 05/11"
    assert (
        "Pendências\n  - 2 proposta(s) pendente(s)." in m.texto and "https://app.teste/" in m.texto
    )
    assert "R$" not in m.texto and "validação pelo jurídico" in m.texto


class EnviadorFalso:
    def __init__(self) -> None:
        self.enviadas: list[Mensagem] = []

    def enviar(self, msg: Mensagem) -> None:
        self.enviadas.append(msg)


pytestmark_db = pytest.mark.skipif(
    not (os.environ.get("VV_ADMIN_URL_TEST") and os.environ.get("VV_DATABASE_URL_TEST")),
    reason="sem banco de teste",
)


@pytest.fixture
def cena() -> Any:
    assert _admin("select current_database()")[0][0] != "vv"
    emp = str(uuid.uuid4())
    _admin(
        "insert into core.empresas (id, razao_social, cnpj) values (%s, 'Relatório Teste', '11222333000181')",
        emp,
    )

    def usuario(nome: str, permissoes: list[tuple[str, str]]) -> Any:
        u = _admin(
            "insert into core.usuarios (email, nome, email_verificado_em) values (%s, %s, now()) returning id",
            f"r-{uuid.uuid4().hex[:8]}@exemplo.test",
            nome,
        )[0][0]
        v = _admin(
            "insert into core.vinculos (usuario_id, empresa_id, papel) values (%s, %s, 'OPERADOR') returning id",
            u,
            emp,
        )[0][0]
        for m, a in permissoes:
            _admin(
                "insert into core.permissoes (vinculo_id, empresa_id, modulo, acao) values (%s, %s, %s, %s)",
                v,
                emp,
                m,
                a,
            )
        return u

    completo = usuario(
        "Completo",
        [
            ("agenda", "visualizar"),
            ("editais", "visualizar"),
            ("juridico", "visualizar"),
            ("propostas", "visualizar"),
            ("analises", "visualizar"),
            ("documentos", "visualizar"),
            ("contratos", "visualizar"),
        ],
    )
    so_juridico = usuario("Só jurídico", [("juridico", "visualizar")])
    sem_nada = usuario("Sem nada", [("contratos", "visualizar")])
    fonte = _admin("select id from ops.fontes where slug = 'pncp'")[0][0]
    org = _admin(
        "insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values (%s, 'Prefeitura do Relatório', 'PR', '4106902') returning id",
        f"{uuid.uuid4().int % 10**14:014d}",
    )[0][0]
    ed = _admin(
        "insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values (%s, %s, %s, '9/2026', 'Objeto', repeat('a', 64)) returning id",
        fonte,
        f"RD-{uuid.uuid4()}",
        org,
    )[0][0]
    it = _admin(
        "insert into pub.edital_itens (edital_id, numero_item, descricao) values (%s, 1, 'Item') returning id",
        ed,
    )[0][0]
    _admin(
        "insert into priv.oportunidades (empresa_id, edital_id, item_id, nota, faixa, versao_regra, edital_versao) values (%s, %s, %s, 90, 'alta', 'v1', 1)",
        emp,
        ed,
        it,
    )
    ac = _admin(
        "insert into priv.acompanhamentos (empresa_id, edital_id, data_abertura) values (%s, %s, %s) returning id",
        emp,
        ed,
        AGORA + dt.timedelta(days=2),
    )[0][0]
    _admin(
        "insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, data_limite_legal) values (%s, %s, 'impugnacao', %s)",
        emp,
        ac,
        AGORA + dt.timedelta(days=1),
    )
    _admin(
        "insert into priv.sugestoes_pecas (empresa_id, acompanhamento_id, tipo, titulo, duvida) values (%s, %s, 'esclarecimento', 'Dúvida', 'Qual a marca exigida?')",
        emp,
        ac,
    )
    yield {"emp": emp, "completo": completo, "so_juridico": so_juridico, "sem_nada": sem_nada}
    _admin("delete from priv.relatorio_diario_assinaturas")
    _admin("delete from priv.sugestoes_pecas")
    _admin("delete from priv.agenda_eventos")
    _admin("delete from priv.acompanhamentos")
    _admin("delete from priv.oportunidades")
    _admin("delete from core.permissoes where empresa_id = %s", emp)
    _admin("delete from core.vinculos where empresa_id = %s", emp)
    _admin("alter table core.empresas disable trigger user")
    _admin("delete from core.empresas where id = %s", emp)
    _admin("alter table core.empresas enable trigger user")
    _admin("delete from core.usuarios where nome in ('Completo', 'Só jurídico', 'Sem nada')")


@pytestmark_db
def test_cada_pessoa_so_recebe_as_secoes_dos_modulos_que_pode_ver(cena: Any) -> None:
    with psycopg.connect(os.environ["VV_DATABASE_URL_TEST"]) as conn:
        titulos = lambda u: {s.titulo for s in coletar(conn, u, cena["emp"], AGORA)}  # noqa: E731
        completo = titulos(cena["completo"])
        assert {
            "Oportunidades",
            "Disputas nos próximos 7 dias",
            "Prazos jurídicos (próximos 7 dias e vencidos)",
            "Jurídico",
        } <= completo
        assert titulos(cena["so_juridico"]) == {"Jurídico"}
        assert titulos(cena["sem_nada"]) == set()  # contratos sem nada a relatar: nada a enviar


@pytestmark_db
def test_fila_envia_uma_vez_por_dia_so_para_assinatura_ativa(cena: Any) -> None:
    for u in (cena["completo"], cena["sem_nada"]):
        _admin(
            "insert into priv.relatorio_diario_assinaturas (empresa_id, usuario_id) values (%s, %s)",
            cena["emp"],
            u,
        )
    _admin(
        "insert into priv.relatorio_diario_assinaturas (empresa_id, usuario_id, ativo) values (%s, %s, false)",
        cena["emp"],
        cena["so_juridico"],
    )
    s = Settings(database_url=os.environ["VV_DATABASE_URL_TEST"], app_url="http://app.teste")  # type: ignore[arg-type]
    enviador = EnviadorFalso()
    with psycopg.connect(os.environ["VV_DATABASE_URL_TEST"]) as conn:
        assert enfileirar(conn, HOJE) == 2  # a desligada não entra
        enfileirar(conn, HOJE)  # repetir a rodada não duplica (chave de idempotência)
        while processar_lote(conn, Handlers(s, enviador).tipos()):
            pass
    assert len(enviador.enviadas) == 1  # o usuário sem nada a relatar não recebe e-mail vazio
    msg = enviador.enviadas[0]
    assert (
        msg.assunto.startswith("Relatório diário · Relatório Teste")
        and "Prefeitura do Relatório" in msg.texto
    )
    ultimos = _admin(
        "select count(*) from priv.relatorio_diario_assinaturas where ultimo_envio is not null"
    )[0][0]
    assert ultimos == 2
