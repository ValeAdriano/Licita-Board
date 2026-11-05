"""Prazos e feriados. ATENÇÃO: são casos TÉCNICOS escritos por quem desenvolveu para fixar a convenção
provisória (rules/prazos.py). NÃO são os casos do jurídico VV (CA-5 da Fase 05 segue pendente)."""

from datetime import UTC, date, datetime

import pytest

from worker.rules.feriados import feriados_nacionais, pascoa
from worker.rules.prazos import FUSO, Regra, calcular, deslocar_dias_uteis, eh_dia_util


def nao_uteis(ano: int) -> dict[date, str]:
    return {f.data: f.nome for f in feriados_nacionais(ano)}


def dt(a: int, m: int, d: int, h: int = 10, mi: int = 0) -> datetime:
    return datetime(a, m, d, h, mi, tzinfo=FUSO)


ESCLARECIMENTO = Regra(
    "esclarecimento", "abertura", 3, "dias_uteis", "antes", "Lei 14.133/2021, art. 164"
)
RESPOSTA = Regra(
    "resposta_administracao",
    "peca_protocolada",
    3,
    "dias_uteis",
    "depois",
    "art. 164, p. único",
    limite_superior="ultimo_dia_util_antes_abertura",
)
ME_EPP = Regra(
    "regularizacao_fiscal_me_epp",
    "declaracao_vencedora",
    5,
    "dias_uteis",
    "depois",
    "LC 123, art. 43, §1º",
    prorrogavel=True,
)
INTENCAO = Regra("intencao_recurso", "sessao_resultado", 0, "imediato", "depois", "art. 165, §1º")


@pytest.mark.parametrize(
    ("ano", "esperada"),
    [
        (2024, date(2024, 3, 31)),
        (2025, date(2025, 4, 20)),
        (2026, date(2026, 4, 5)),
        (2027, date(2027, 3, 28)),
    ],
)
def test_pascoa(ano: int, esperada: date) -> None:
    assert pascoa(ano) == esperada


def test_feriados_moveis_de_2026() -> None:
    por_nome = {f.nome: f for f in feriados_nacionais(2026)}
    assert (
        por_nome["Sexta-feira Santa"].data == date(2026, 4, 3)
        and por_nome["Sexta-feira Santa"].tipo == "feriado"
    )
    assert por_nome["Carnaval (segunda-feira)"].data == date(2026, 2, 16)
    assert por_nome["Carnaval (terça-feira)"].tipo == "ponto_facultativo"
    assert por_nome["Corpus Christi"].data == date(2026, 6, 4)


def test_consciencia_negra_so_vale_a_partir_de_2024() -> None:
    assert date(2023, 11, 20) not in nao_uteis(2023)
    assert date(2025, 11, 20) in nao_uteis(2025)


def test_dia_util() -> None:
    n = nao_uteis(2026)
    assert eh_dia_util(date(2026, 12, 14), n)  # segunda
    assert not eh_dia_util(date(2026, 12, 13), n)  # domingo
    assert not eh_dia_util(date(2026, 12, 25), n)  # Natal


def test_tres_dias_uteis_antes_sem_feriado() -> None:
    r = calcular(ESCLARECIMENTO, dt(2026, 12, 16), nao_uteis(2026))  # quarta
    assert r.limite == datetime(
        2026, 12, 11, 23, 59, tzinfo=FUSO
    )  # sexta (terça 15, segunda 14, sexta 11)
    assert r.origem == "regra" and r.avisos == ()


def test_tres_dias_uteis_antes_pulando_natal_e_fim_de_semana() -> None:
    r = calcular(ESCLARECIMENTO, dt(2026, 12, 28), nao_uteis(2026))  # segunda
    assert r.limite.date() == date(2026, 12, 22)  # 25/12 é feriado e fim de semana não conta
    assert any("Natal" in a for a in r.avisos)


def test_tres_dias_uteis_antes_pulando_sexta_santa() -> None:
    assert calcular(ESCLARECIMENTO, dt(2026, 4, 7), nao_uteis(2026)).limite.date() == date(
        2026, 4, 1
    )


def test_ponto_facultativo_nao_conta_e_avisa() -> None:
    r = calcular(ESCLARECIMENTO, dt(2026, 2, 18), nao_uteis(2026))  # quarta de cinzas
    assert r.limite.date() == date(2026, 2, 11)
    assert any("Carnaval" in a for a in r.avisos)


def test_feriado_municipal_entra_na_conta() -> None:
    n = {**nao_uteis(2026), date(2026, 12, 15): "Aniversário do município"}
    assert calcular(ESCLARECIMENTO, dt(2026, 12, 16), n).limite.date() == date(2026, 12, 10)


def test_depois_exclui_o_dia_do_comeco_e_pula_feriado() -> None:
    d, _ = deslocar_dias_uteis(
        date(2026, 4, 2), 3, "depois", nao_uteis(2026)
    )  # quinta antes da Sexta Santa
    assert d == date(2026, 4, 8)  # sexta 3 (feriado), 6 (1), 7 (2), 8 (3)


def test_base_em_dia_nao_util_conta_a_partir_do_proximo_util() -> None:
    d, _ = deslocar_dias_uteis(date(2026, 12, 12), 1, "depois", nao_uteis(2026))  # sábado
    assert d == date(2026, 12, 14)


def test_regularizacao_me_epp_cinco_dias_uteis() -> None:
    r = calcular(ME_EPP, dt(2026, 4, 17), nao_uteis(2026))  # sexta; 21/04 Tiradentes
    assert r.limite.date() == date(2026, 4, 27)
    assert r.artigo.startswith("LC 123")


def test_resposta_da_administracao_limitada_ao_ultimo_dia_util_antes_da_abertura() -> None:
    # peça protocolada na segunda 14/12, abertura na quarta 16/12: 3 dias úteis seria 17/12, mas o teto é 15/12.
    r = calcular(RESPOSTA, dt(2026, 12, 14), nao_uteis(2026), abertura=dt(2026, 12, 16))
    assert r.limite.date() == date(2026, 12, 15)
    assert "limitado" in r.avisos[0]


def test_resposta_sem_abertura_avisa_que_nao_aplicou_o_teto() -> None:
    r = calcular(RESPOSTA, dt(2026, 12, 14), nao_uteis(2026))
    assert r.limite.date() == date(2026, 12, 17)
    assert any("sem data de abertura" in a for a in r.avisos)


def test_intencao_de_recurso_e_imediata() -> None:
    base = dt(2026, 12, 16, 14, 30)
    r = calcular(INTENCAO, base, nao_uteis(2026))
    assert r.limite == base and r.interna == base


def test_prazo_do_edital_prevalece_com_a_clausula() -> None:
    fixado = dt(2026, 12, 9, 17, 0)
    r = calcular(
        ESCLARECIMENTO, dt(2026, 12, 16), nao_uteis(2026), prazo_edital=fixado, clausula="item 12.1"
    )
    assert (r.limite, r.origem, r.clausula) == (fixado, "edital", "item 12.1")
    assert r.avisos == ()


def test_data_interna_dois_dias_uteis_antes_do_limite() -> None:
    r = calcular(ESCLARECIMENTO, dt(2026, 12, 16), nao_uteis(2026))  # limite sexta 11/12
    assert r.interna.date() == date(2026, 12, 9)  # quarta
    assert calcular(
        ESCLARECIMENTO, dt(2026, 12, 16), nao_uteis(2026), dias_internos=0
    ).interna.date() == date(2026, 12, 11)


def test_borda_de_fuso_23h59_e_meia_noite() -> None:
    # 23:59 de 15/12 e 00:01 de 16/12 em Brasília são 02:59 e 03:01 UTC de 16/12: o dia vale o de Brasília.
    antes = calcular(ESCLARECIMENTO, datetime(2026, 12, 16, 2, 59, tzinfo=UTC), nao_uteis(2026))
    depois = calcular(ESCLARECIMENTO, datetime(2026, 12, 16, 3, 1, tzinfo=UTC), nao_uteis(2026))
    assert antes.limite.date() == date(2026, 12, 10)  # base 15/12 (terça)
    assert depois.limite.date() == date(2026, 12, 11)  # base 16/12 (quarta)
