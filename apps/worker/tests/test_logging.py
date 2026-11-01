import json
import logging

from worker.logging import JsonFormatter

REDACTED = "[REDACTED]"


def test_log_redige_campos_sensiveis() -> None:
    record = logging.LogRecord("t", logging.INFO, __file__, 1, "msg", None, None)
    record.ctx = {"empresa_id": "e1", "cpf": "000.000.000-00", "nested": {"token": "abc"}}
    out = json.loads(JsonFormatter().format(record))
    assert out["ctx"]["empresa_id"] == "e1"
    assert out["ctx"]["cpf"] == REDACTED
    assert out["ctx"]["nested"]["token"] == REDACTED
