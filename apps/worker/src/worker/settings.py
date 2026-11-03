from typing import Literal
from urllib.parse import urlsplit

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuração lida só do ambiente. Segredos ficam em SecretStr e nunca vão para log."""

    # hide_input_in_errors: erro de validação nunca repete o valor (a URL carrega a senha).
    model_config = SettingsConfigDict(
        env_prefix="VV_", env_file=".env", extra="ignore", hide_input_in_errors=True
    )

    env: Literal["dev", "homolog", "prod"] = "dev"
    # Conexão como vv_worker (ADR-013): BYPASSRLS, então todo job valida empresa_id no banco.
    database_url: SecretStr = SecretStr("")
    log_level: str = "INFO"
    healthcheck_url: str = ""

    @field_validator("database_url")
    @classmethod
    def _papel_vv_worker(cls, v: SecretStr) -> SecretStr:
        url = v.get_secret_value()
        if url and urlsplit(url).username != "vv_worker":
            # Sem repetir a URL: ela carrega a senha.
            raise ValueError("VV_DATABASE_URL precisa usar o papel vv_worker")
        return v
