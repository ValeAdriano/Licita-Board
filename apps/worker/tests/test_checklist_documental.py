from datetime import date

from worker.rules.checklist_documental import (
    AVISO_ME_EPP,
    DocumentoEmpresa,
    Exigencia,
    Situacao,
    checklist_documental,
)

HOJE = date(2026, 11, 4)
SESSAO = date(2026, 12, 10)


def um(exig: Exigencia, docs: list[DocumentoEmpresa], **kw):  # type: ignore[no-untyped-def]
    return checklist_documental([exig], docs, HOJE, **kw)[0]


def test_valido_com_dias_para_vencer() -> None:
    i = um(Exigencia("cnd_federal"), [DocumentoEmpresa("cnd_federal", date(2027, 1, 1))])
    assert i.situacao is Situacao.VALIDO
    assert i.dias_para_vencer == 58


def test_vencido() -> None:
    i = um(Exigencia("cnd_federal"), [DocumentoEmpresa("cnd_federal", date(2026, 11, 3))])
    assert (i.situacao, i.dias_para_vencer) == (Situacao.VENCIDO, -1)


def test_vence_hoje_ainda_vale() -> None:
    assert um(Exigencia("x"), [DocumentoEmpresa("x", HOJE)]).situacao is Situacao.VALIDO


def test_vence_antes_da_sessao() -> None:
    i = um(Exigencia("x"), [DocumentoEmpresa("x", date(2026, 12, 9))], data_sessao=SESSAO)
    assert i.situacao is Situacao.VENCE_ANTES_DA_SESSAO


def test_vence_no_dia_da_sessao_vale() -> None:
    assert (
        um(Exigencia("x"), [DocumentoEmpresa("x", SESSAO)], data_sessao=SESSAO).situacao
        is Situacao.VALIDO
    )


def test_sem_data_de_sessao_nao_acusa_vencimento_futuro() -> None:
    assert (
        um(Exigencia("x"), [DocumentoEmpresa("x", date(2026, 11, 20))]).situacao is Situacao.VALIDO
    )


def test_ausente() -> None:
    assert um(Exigencia("x"), []).situacao is Situacao.AUSENTE


def test_outro_tipo_nao_conta() -> None:
    assert (
        um(Exigencia("x"), [DocumentoEmpresa("y", date(2030, 1, 1))]).situacao is Situacao.AUSENTE
    )


def test_nao_aplicavel() -> None:
    assert um(Exigencia("x", aplicavel=False), []).situacao is Situacao.NAO_APLICAVEL


def test_sem_vencimento_e_valido() -> None:
    i = um(Exigencia("x"), [DocumentoEmpresa("x", None, sem_vencimento=True)], data_sessao=SESSAO)
    assert (i.situacao, i.dias_para_vencer) == (Situacao.VALIDO, None)


def test_sem_data_e_sem_marca_depende_de_conferencia() -> None:
    assert (
        um(Exigencia("x"), [DocumentoEmpresa("x", None)]).situacao is Situacao.DEPENDE_CONFERENCIA
    )


def test_conferencia_manual_nunca_marca_valido() -> None:
    doc = [DocumentoEmpresa("balanco", date(2030, 1, 1))]
    assert (
        um(Exigencia("balanco", conferencia_manual=True), doc).situacao
        is Situacao.DEPENDE_CONFERENCIA
    )
    assert (
        um(Exigencia("balanco", conferencia_manual=True), []).situacao
        is Situacao.DEPENDE_CONFERENCIA
    )


def test_varios_documentos_vale_o_de_maior_validade() -> None:
    docs = [DocumentoEmpresa("x", date(2026, 1, 1)), DocumentoEmpresa("x", date(2027, 6, 1))]
    assert um(Exigencia("x"), docs).situacao is Situacao.VALIDO


def test_sem_vencimento_prevalece_sobre_outros() -> None:
    docs = [
        DocumentoEmpresa("x", date(2026, 1, 1)),
        DocumentoEmpresa("x", None, sem_vencimento=True),
    ]
    assert um(Exigencia("x"), docs).situacao is Situacao.VALIDO


def test_me_epp_sinaliza_sem_dispensar() -> None:
    e = Exigencia("cnd_federal", regularidade_fiscal=True)
    i = um(e, [DocumentoEmpresa("cnd_federal", date(2026, 10, 1))], me_epp=True)
    assert i.situacao is Situacao.VENCIDO
    assert i.aviso == AVISO_ME_EPP


def test_me_epp_nao_avisa_se_estiver_valido_ou_nao_for_fiscal() -> None:
    fiscal = Exigencia("cnd_federal", regularidade_fiscal=True)
    assert (
        um(fiscal, [DocumentoEmpresa("cnd_federal", date(2027, 1, 1))], me_epp=True).aviso is None
    )
    assert um(Exigencia("x"), [], me_epp=True).aviso is None
    assert um(fiscal, [], me_epp=False).aviso is None


def test_ordem_das_exigencias_e_preservada() -> None:
    r = checklist_documental([Exigencia("b"), Exigencia("a")], [], HOJE)
    assert [i.tipo for i in r] == ["b", "a"]
