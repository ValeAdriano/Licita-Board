import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

from worker.settings import Settings


@dataclass(frozen=True)
class Mensagem:
    para: str
    assunto: str
    texto: str


class Enviador(Protocol):
    def enviar(self, msg: Mensagem) -> None: ...


class EnviadorSmtp:
    """SMTP simples: Mailpit em dev, provedor transacional via SMTP em prod. Só texto."""

    def __init__(self, settings: Settings) -> None:
        self._s = settings

    def enviar(self, msg: Mensagem) -> None:
        email = EmailMessage()
        email["From"] = self._s.email_remetente
        email["To"] = msg.para
        email["Subject"] = msg.assunto
        email.set_content(msg.texto)
        with smtplib.SMTP(self._s.smtp_host, self._s.smtp_port, timeout=15) as smtp:
            if self._s.smtp_starttls:
                smtp.starttls(context=ssl.create_default_context())  # confere o certificado
            if self._s.smtp_usuario:
                smtp.login(self._s.smtp_usuario, self._s.smtp_senha.get_secret_value())
            smtp.send_message(email)


_EVENTOS = {
    "senha_alterada": "a senha da sua conta foi alterada",
    "acesso_redefinido": "o acesso da sua conta foi redefinido por um administrador",
    "autenticador_cadastrado": "um autenticador foi cadastrado na sua conta",
    "autenticador_removido": "o autenticador da sua conta foi removido",
    "login_novo": "houve um acesso à sua conta a partir de um endereço novo",
}


def mensagem_recuperacao(para: str, link: str) -> Mensagem:
    # Sem nome nem dado da conta (o nome pode ter sido definido por terceiros, T3.1); o link expira
    # em 30 min e serve uma vez.
    texto = (
        "Olá.\n\n"
        "Recebemos um pedido para redefinir a senha da sua conta no VV Licitações.\n"
        "Para criar uma senha nova, abra o link abaixo (vale por 30 minutos e uma única vez):\n\n"
        f"{link}\n\n"
        "Se não foi você, ignore este e-mail: sua senha continua a mesma.\n"
    )
    return Mensagem(para=para, assunto="Redefinição de senha · VV Licitações", texto=texto)


def mensagem_alerta(para: str, eventos: list[str]) -> Mensagem | None:
    linhas = [f"- {_EVENTOS[e]}" for e in dict.fromkeys(eventos) if e in _EVENTOS]
    if not linhas:
        return None
    texto = (
        "Agora há pouco:\n"
        + "\n".join(linhas)
        + "\n\nSe foi você, nada a fazer. Se não foi, redefina sua senha e avise o administrador "
        "da sua empresa imediatamente.\n"
    )
    return Mensagem(para=para, assunto="Alerta de segurança · VV Licitações", texto=texto)
