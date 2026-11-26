from pathlib import Path

import pytest
from pydantic import ValidationError

from worker.settings import Settings


def test_aceita_vv_worker() -> None:
    s = Settings(database_url="postgresql://vv_worker:segredo@db:5432/vv")  # type: ignore[arg-type]
    assert s.database_url.get_secret_value().startswith("postgresql://vv_worker:")


@pytest.mark.parametrize("papel", ["vv_api", "vv_owner", "postgres"])
def test_recusa_outro_papel_sem_vazar_senha(papel: str) -> None:
    with pytest.raises(ValidationError) as erro:
        Settings(database_url=f"postgresql://{papel}:senha-secreta@db/vv")  # type: ignore[arg-type]
    assert "vv_worker" in str(erro.value)
    assert "senha-secreta" not in str(erro.value)


def test_url_nunca_aparece_no_repr() -> None:
    s = Settings(database_url="postgresql://vv_worker:senha-secreta@db/vv")  # type: ignore[arg-type]
    assert "senha-secreta" not in repr(s)


def test_fora_de_dev_com_fila_exige_smtp_seguro_e_link_https() -> None:
    base = {"env": "prod", "fila_ativa": True}
    with pytest.raises(ValidationError):
        Settings(**base)  # type: ignore[arg-type]
    ok = Settings(  # type: ignore[arg-type]
        **base, smtp_starttls=True, smtp_usuario="resend", app_url="https://app.vv.test"
    )
    assert ok.app_url.startswith("https://")


def test_vapid_exige_contato_mailto_ou_https_e_nunca_aparece_no_repr() -> None:
    with pytest.raises(ValidationError):
        Settings(vapid_private_key="segredo-vapid", vapid_contato="ti@vv.test")  # type: ignore[arg-type]
    ok = Settings(vapid_private_key="segredo-vapid", vapid_contato="mailto:ti@vv.test")  # type: ignore[arg-type]
    assert ok.vapid_private_key.get_secret_value() == "segredo-vapid"
    assert "segredo-vapid" not in repr(ok)


def test_segredo_em_arquivo_vira_o_campo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    url = tmp_path / "url"
    url.write_text("postgresql://vv_worker:segredo@db/vv\n", encoding="utf-8")
    monkeypatch.delenv("VV_DATABASE_URL", raising=False)
    monkeypatch.setenv("VV_DATABASE_URL_FILE", str(url))
    s = Settings()
    assert s.database_url.get_secret_value() == "postgresql://vv_worker:segredo@db/vv"
    assert "segredo" not in repr(s)


def test_segredo_em_arquivo_e_no_ambiente_ao_mesmo_tempo_e_erro(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    kek = tmp_path / "kek"
    kek.write_text("x" * 40, encoding="utf-8")
    monkeypatch.setenv("VV_KEK", "y" * 40)
    monkeypatch.setenv("VV_KEK_FILE", str(kek))
    with pytest.raises(ValueError, match="VV_KEK e VV_KEK_FILE"):
        Settings()


def test_arquivo_ausente_derruba_a_subida(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VV_KEK", raising=False)
    monkeypatch.setenv("VV_KEK_FILE", str(tmp_path / "nao-existe"))
    with pytest.raises(ValueError, match="não consegui ler o arquivo de VV_KEK_FILE"):
        Settings()
