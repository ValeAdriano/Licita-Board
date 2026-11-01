import json
import logging
from datetime import UTC, datetime
from typing import Any

# Chaves que nunca podem aparecer em log (LGPD + modelo de ameaças, ameaça 4).
_REDACTED_KEYS = frozenset(
    {"cpf", "senha", "password", "token", "pix", "chave", "api_key", "authorization", "secret"}
)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: "[REDACTED]" if k.lower() in _REDACTED_KEYS else _redact(v) for k, v in value.items()
        }
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


class JsonFormatter(logging.Formatter):
    """Uma linha JSON por evento. Campos extras passam por `extra={"ctx": {...}}`."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        ctx = getattr(record, "ctx", None)
        if isinstance(ctx, dict):
            payload["ctx"] = _redact(ctx)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
