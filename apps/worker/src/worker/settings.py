from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuração lida só do ambiente. Segredos ficam em SecretStr e nunca vão para log."""

    model_config = SettingsConfigDict(env_prefix="VV_", env_file=".env", extra="ignore")

    env: Literal["dev", "homolog", "prod"] = "dev"
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_service_role_key: SecretStr = SecretStr("")
    log_level: str = "INFO"
    healthcheck_url: str = ""
