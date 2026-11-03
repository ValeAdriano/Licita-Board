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
