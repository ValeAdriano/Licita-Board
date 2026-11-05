from datetime import date

from worker.rules.vencimentos import Documento, resumo, vencem_antes

ABERTURA = date(2026, 12, 16)


def test_vence_antes_so_o_estritamente_anterior_ao_dia_da_abertura() -> None:
    docs = [
        Documento("CND Federal", date(2026, 12, 15)),
        Documento("FGTS", date(2026, 12, 16)),  # vale até o fim do dia da abertura
        Documento("Contrato social", date(2027, 3, 1)),
        Documento("CND Estadual", date(2026, 11, 1)),
    ]
    r = vencem_antes(docs, ABERTURA)
    assert [d.descricao for d in r] == ["CND Estadual", "CND Federal"]


def test_sem_documentos_nao_ha_alerta() -> None:
    assert vencem_antes([], ABERTURA) == []
    assert resumo([], ABERTURA, date(2026, 11, 5)) == ""


def test_resumo_marca_vencido_atualizacao_e_trunca() -> None:
    docs = [Documento(f"Doc {i}", date(2026, 11, 1 + i), em_atualizacao=(i == 0)) for i in range(6)]
    t = resumo(docs, ABERTURA, date(2026, 11, 3))
    assert t.startswith("6 documento(s) vencem antes da abertura de 16/12/2026")
    assert "Doc 0 (VENCIDO, em atualização)" in t
    assert "Doc 3 (vence 04/11/2026)" in t
    assert t.endswith("e mais 2")
    assert len(t) <= 500
