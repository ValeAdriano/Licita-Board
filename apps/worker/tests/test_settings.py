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
