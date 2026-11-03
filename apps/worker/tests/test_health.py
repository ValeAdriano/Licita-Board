import pytest
from fastapi.testclient import TestClient

from worker import main
from worker.main import app


def test_health_responde_ok_com_banco(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "banco_ok", lambda _url: True)
    resp = TestClient(app).get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "banco": "ok", "env": "dev"}


def test_health_503_sem_detalhe_quando_banco_cai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "banco_ok", lambda _url: False)
    resp = TestClient(app).get("/health")
    assert resp.status_code == 503
    assert resp.json() == {"status": "erro", "banco": "indisponivel"}


def test_banco_ok_falso_sem_url_ou_inalcancavel() -> None:
    assert main.banco_ok("") is False
    assert main.banco_ok("postgresql://vv_worker:x@127.0.0.1:1/vv") is False


def test_sem_docs_publicas() -> None:
    assert TestClient(app).get("/docs").status_code == 404
