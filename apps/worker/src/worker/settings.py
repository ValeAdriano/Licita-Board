from typing import Literal
from urllib.parse import urlsplit

from pydantic import SecretStr, field_validator, model_validator
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
    # Fila (ADR-014): o consumidor só roda com fila_ativa (compose de dev/prod); testes não.
    fila_ativa: bool = False
    # E-mail transacional por SMTP (Mailpit em dev; Resend/SES via SMTP em prod, spec decisão 3).
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_usuario: str = ""
    smtp_senha: SecretStr = SecretStr("")
    smtp_starttls: bool = False
    email_remetente: str = "VV Licitações <nao-responda@vv.local>"
    # Web Push (ADR-018): chave privada VAPID (base64url, `uv run python scripts/gerar_vapid.py`) e
    # contato (mailto: ou https:) que o serviço de push usa para falar com quem opera o servidor.
    # Sem a chave, o push fica desligado e os jobs `push_notificacao` aguardam na fila.
    vapid_private_key: SecretStr = SecretStr("")
    vapid_contato: str = "mailto:ti@vv.local"
    # Chave pública VAPID que a API publica: o worker confere que ela é a do par da privada (par
    # trocado = o serviço de push recusa tudo com 401/403). Opcional.
    vapid_public_key: str = ""
    # URL pública do app, base dos links enviados por e-mail.
    app_url: str = "http://localhost:5173"

    @field_validator("database_url")
    @classmethod
    def _papel_vv_worker(cls, v: SecretStr) -> SecretStr:
        url = v.get_secret_value()
        if url and urlsplit(url).username != "vv_worker":
            # Sem repetir a URL: ela carrega a senha.
            raise ValueError("VV_DATABASE_URL precisa usar o papel vv_worker")
        return v

    @model_validator(mode="after")
    def _seguro_fora_de_dev(self) -> "Settings":
        # O token de recuperação viaja por e-mail: fora de dev, SMTP com TLS e login; link https.
        if self.env != "dev" and self.fila_ativa:
            if not (self.smtp_starttls and self.smtp_usuario):
                raise ValueError("fora de dev, SMTP exige STARTTLS e usuário")
            if not self.app_url.startswith("https://"):
                raise ValueError("fora de dev, VV_APP_URL precisa ser https")
        if self.vapid_private_key.get_secret_value() and not self.vapid_contato.startswith(
            ("mailto:", "https://")
        ):
            raise ValueError("VV_VAPID_CONTATO precisa começar com mailto: ou https://")
        return self
