import os
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import SecretStr, field_validator, model_validator
from pydantic.fields import FieldInfo
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)


class SegredoEmArquivo(PydanticBaseSettingsSource):
    """`VV_X_FILE=/run/secrets/x` vira o campo `x` com o conteúdo do arquivo (Docker secrets, ADR-015).

    O segredo não fica no ambiente do container (`docker inspect`). `VV_X` e `VV_X_FILE` juntos é erro.
    """

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        return None, field_name, False  # tudo é resolvido em __call__

    def __call__(self) -> dict[str, Any]:
        saida: dict[str, Any] = {}
        for nome in self.settings_cls.model_fields:
            chave = f"VV_{nome.upper()}"
            caminho = os.environ.get(f"{chave}_FILE")
            if not caminho:
                continue
            if chave in os.environ:
                raise ValueError(f"{chave} e {chave}_FILE ao mesmo tempo")
            try:
                texto = Path(caminho).read_text(encoding="utf-8")
            except OSError:
                raise ValueError(f"não consegui ler o arquivo de {chave}_FILE") from None
            saida[nome] = texto.removesuffix("\n").removesuffix("\r")
        return saida


class Settings(BaseSettings):
    """Configuração lida só do ambiente. Segredos ficam em SecretStr e nunca vão para log."""

    # hide_input_in_errors: erro de validação nunca repete o valor (a URL carrega a senha).
    model_config = SettingsConfigDict(
        env_prefix="VV_", env_file=".env", extra="ignore", hide_input_in_errors=True
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            SegredoEmArquivo(settings_cls),
            dotenv_settings,
            file_secret_settings,
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
    # S3 dos documentos (ADR-017): o worker verifica a quarentena e move o liberado. Vazio = sem
    # verificação (jobs `verificar_arquivo` aguardam na fila). ClamAV por socket TCP (clamd).
    s3_endpoint: str = ""
    s3_bucket: str = ""
    s3_access_key: str = ""
    s3_secret_key: SecretStr = SecretStr("")
    clamav_host: str = ""
    clamav_porta: int = 3310
    # Pesquisa de editais (Fase 04): ping de heartbeat (Healthchecks.io) a cada execução ok
    # (a ausência em 30 min alerta por fora) e o contato que o robô informa no User-Agent.
    pesquisa_heartbeat_url: str = ""
    robo_contato: str = ""
    # Anexo em ZIP (decisão 6 da Fase 04): limites da extração; estourou um, o ZIP inteiro é recusado.
    zip_max_arquivos: int = 50
    zip_max_total_mb: int = 200
    zip_max_arquivo_mb: int = 50
    zip_max_razao: int = 100
    # IA de extração de requisitos (Fase 06, decisão do Adriano em 2026-11-05): chave do provedor (Anthropic). Vazia = IA DESLIGADA.
    # A chave só vem do ambiente (.env fora do git), nunca de código; o modelo é configurável.
    anthropic_api_key: SecretStr = SecretStr("")
    # Chave-mestra (KEK): só o worker e a API a têm. O worker decifra a chave de IA cadastrada pela empresa (ADR-017).
    kek: SecretStr = SecretStr("")
    llm_modelo: str = "claude-sonnet-5-5"
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
