from worker.email import mensagem_alerta, mensagem_recuperacao


def test_recuperacao_leva_o_link_so_no_corpo_e_sem_nome() -> None:
    m = mensagem_recuperacao("ana@teste.local", "http://app/redefinir-senha#token=abc")
    assert m.para == "ana@teste.local"
    assert "#token=abc" in m.texto
    assert "abc" not in m.assunto
    assert "30 minutos" in m.texto


def test_alerta_junta_eventos_e_ignora_desconhecidos() -> None:
    eventos = ["autenticador_removido", "autenticador_cadastrado", "x"]
    m = mensagem_alerta("ana@teste.local", eventos)
    assert m is not None
    assert "removido" in m.texto and "cadastrado" in m.texto
    assert mensagem_alerta("ana@teste.local", ["inventado"]) is None
