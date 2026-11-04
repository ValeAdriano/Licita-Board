from worker.documentos import verificar

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
EICAR = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


class Limpo:
    def varrer(self, dados: bytes) -> str | None:
        return None


class ComEicar:
    def varrer(self, dados: bytes) -> str | None:
        return "Eicar-Test-Signature" if b"EICAR-STANDARD" in dados else None


def test_pdf_limpo_e_liberado_com_hash_e_tipo_real() -> None:
    v = verificar(PDF, Limpo())
    assert (v.status, v.tipo_real) == ("liberado", "application/pdf")
    assert v.sha256 is not None and len(v.sha256) == 64


def test_eicar_e_bloqueado_pelo_antivirus() -> None:
    v = verificar(EICAR, ComEicar())
    assert v.status == "bloqueado"


def test_pdf_com_eicar_dentro_e_bloqueado() -> None:
    v = verificar(PDF + EICAR, ComEicar())
    assert v.status == "bloqueado" and "antivírus" in (v.motivo or "")


def test_tipo_real_vale_mais_que_a_extensao() -> None:
    v = verificar(b"#!/bin/sh\necho oi\n", Limpo())
    assert v.status == "bloqueado" and "tipo" in (v.motivo or "")


def test_vazio_e_grande_demais_sao_bloqueados() -> None:
    assert verificar(b"", Limpo()).status == "bloqueado"
    assert verificar(PDF + b"0" * (26 * 1024 * 1024), Limpo()).status == "bloqueado"
