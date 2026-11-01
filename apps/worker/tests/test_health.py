from fastapi.testclient import TestClient

from worker.main import app


def test_health_responde_ok() -> None:
    resp = TestClient(app).get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_sem_docs_publicas() -> None:
    assert TestClient(app).get("/docs").status_code == 404
