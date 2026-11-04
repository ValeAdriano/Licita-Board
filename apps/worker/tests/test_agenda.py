"""Agendador e vigilância da pesquisa (Fase 04). A parte pura roda sempre; a do banco precisa de
VV_ADMIN_URL_TEST (superusuário no banco de teste) e age como vv_worker (`set role`)."""

import os
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
import pytest

from worker.pesquisa.agenda import FUSO, agendar, atrasada, janelas_devidas, janelas_do_dia, vigiar

HORARIOS = ["07:00", "12:00", "17:00"]


def hora(h: int, m: int = 0, dia: int = 4) -> datetime:
    return datetime(2026, 11, dia, h, m, tzinfo=FUSO)


def test_tres_janelas_por_dia_a_primeira_e_principal() -> None:
    js = janelas_do_dia(date(2026, 11, 4), HORARIOS)
    assert [j.quando.hour for j in js] == [7, 12, 17]
    assert [j.tipo for j in js] == ["principal", "incremental", "incremental"]
    assert all(j.quando.tzinfo is not None for j in js)


def test_janelas_devidas_so_as_que_ja_passaram() -> None:
    assert janelas_devidas(hora(6, 59), HORARIOS) == []
    assert [j.quando.hour for j in janelas_devidas(hora(7, 0), HORARIOS)] == [7]
    assert [j.quando.hour for j in janelas_devidas(hora(13), HORARIOS)] == [7, 12]


def test_janela_vale_no_fuso_de_brasilia_mesmo_com_agora_em_utc() -> None:
    utc = datetime(2026, 11, 4, 10, 5, tzinfo=UTC)  # 07:05 em Brasília
    assert [j.quando.hour for j in janelas_devidas(utc, HORARIOS)] == [7]


def test_atraso_acima_da_tolerancia() -> None:
    j = janelas_do_dia(date(2026, 11, 4), HORARIOS)[0]
    assert not atrasada(j, hora(7, 15))
    assert atrasada(j, hora(7, 16))


def test_horario_com_minuto() -> None:
    js = janelas_do_dia(date(2026, 11, 4), ["07:30", "07:00"])
    assert [(j.quando.hour, j.quando.minute) for j in js] == [(7, 0), (7, 30)]


ADMIN = os.environ.get("VV_ADMIN_URL_TEST", "")
com_banco = pytest.mark.skipif(not ADMIN, reason="sem banco de teste")


@pytest.fixture
def banco() -> Any:
    """Conexão superusuária que age como vv_worker; remove tudo o que o teste criou."""
    sufixo = uuid.uuid4().hex[:8]
    slug = f"teste_{sufixo}"
    email = f"super-{sufixo}@teste.local"
    with psycopg.connect(ADMIN, autocommit=True) as c:
        c.execute(
            "insert into core.usuarios (email, nome, superadmin, email_verificado_em) "
            "values (%s, 'Super Teste', true, now())",
            (email,),
        )
        fonte = c.execute(
            "insert into ops.fontes (slug, nome, url_base, tipo_integracao, ativa, status) "
            "values (%s, 'Fonte de teste', 'https://exemplo.test', 'api_oficial', true, 'ok') "
            "returning id",
            (slug,),
        ).fetchone()
    assert fonte is not None
    fonte_id = fonte[0]
    conn = psycopg.connect(ADMIN)
    conn.execute("set role vv_worker")
    conn.commit()
    yield conn, fonte_id, slug, email
    conn.close()
    with psycopg.connect(ADMIN, autocommit=True) as c:
        c.execute(
            "delete from ops.jobs where chave_idempotencia like %s or chave_idempotencia like %s",
            (f"coleta:{slug}:%", f"op:%:{slug}:%"),
        )
        c.execute("delete from ops.execucoes where fonte_id = %s", (fonte_id,))
        c.execute("delete from ops.fontes where id = %s", (fonte_id,))
        c.execute("alter table core.notificacoes disable trigger user")
        c.execute(
            "delete from core.notificacoes where usuario_id = "
            "(select id from core.usuarios where email = %s)",
            (email,),
        )
        c.execute("alter table core.notificacoes enable trigger user")
        c.execute("delete from ops.jobs where payload ->> 'fonte' = %s", (slug,))


def _execucoes(fonte_id: Any) -> list[tuple[Any, ...]]:
    with psycopg.connect(ADMIN) as c:
        return c.execute(
            "select tipo, status, detalhe from ops.execucoes "
            "where fonte_id = %s order by agendada_para",
            (fonte_id,),
        ).fetchall()


def _avisos(email: str) -> int:
    with psycopg.connect(ADMIN) as c:
        row = c.execute(
            "select count(*) from core.notificacoes n join core.usuarios u on u.id = n.usuario_id "
            "where u.email = %s and n.tipo = 'pesquisa_alerta'",
            (email,),
        ).fetchone()
    assert row is not None
    return int(row[0])


@com_banco
def test_agenda_no_horario_cria_uma_execucao_e_nao_duplica(banco: Any) -> None:
    conn, fonte_id, slug, _ = banco
    assert agendar(conn, hora(7, 5)) == 1
    assert agendar(conn, hora(7, 6)) == 0  # mesma janela: nada novo
    assert [(t, s) for t, s, _ in _execucoes(fonte_id)] == [("principal", "agendada")]
    with psycopg.connect(ADMIN) as c:
        n = c.execute(
            "select count(*) from ops.jobs where chave_idempotencia like %s", (f"coleta:{slug}:%",)
        ).fetchone()
    assert n is not None and n[0] == 1


@com_banco
def test_worker_subindo_tarde_recupera_a_janela_perdida_e_avisa(banco: Any) -> None:
    conn, fonte_id, _, email = banco
    assert agendar(conn, hora(10, 0)) == 1  # a de 07:00 já passou
    ((tipo, status, detalhe),) = _execucoes(fonte_id)
    assert (tipo, status, detalhe) == ("principal", "perdida", {"recuperada": True})
    assert _avisos(email) == 1


@com_banco
def test_vigia_marca_perdida_uma_unica_vez(banco: Any) -> None:
    conn, fonte_id, _, email = banco
    agendar(conn, hora(7, 5))
    assert vigiar(conn, hora(7, 10)) == 0  # dentro da tolerância
    assert vigiar(conn, hora(7, 30)) == 1
    assert vigiar(conn, hora(7, 31)) == 0
    assert [s for _, s, _ in _execucoes(fonte_id)] == ["perdida"]
    assert _avisos(email) == 1


@com_banco
def test_vigia_derruba_execucao_travada(banco: Any) -> None:
    conn, fonte_id, _, email = banco
    agendar(conn, hora(7, 1))
    with psycopg.connect(ADMIN, autocommit=True) as c:
        c.execute(
            "update ops.execucoes set status = 'executando', iniciada_em = %s where fonte_id = %s",
            (hora(7, 1), fonte_id),
        )
    assert vigiar(conn, hora(7, 1) + timedelta(minutes=61)) == 1
    assert [s for _, s, _ in _execucoes(fonte_id)] == ["falhou"]
    assert _avisos(email) == 1
