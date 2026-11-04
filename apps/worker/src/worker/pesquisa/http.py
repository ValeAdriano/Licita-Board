"""Cliente HTTP dos conectores (Fase 04): só https, só hosts permitidos, limite de taxa, retry com
espera progressiva e robô identificado no User-Agent. Sem dependência nova (urllib)."""

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from decimal import Decimal
from typing import Any

log = logging.getLogger("worker.pesquisa.http")

TENTATIVAS = 4


class ErroPermanente(Exception):  # noqa: N818 - 4xx da fonte: repetir não adianta
    """A fonte respondeu 4xx (exceto 429): o pedido está errado ou o recurso não existe."""


class ErroTransitorio(Exception):  # noqa: N818 - rede, 429 ou 5xx depois de todas as tentativas
    """A fonte não respondeu bem mesmo com retry: a execução falha e o job volta com backoff."""


def host_permitido(url: str, hosts: list[str]) -> bool:
    """https; host igual a um permitido ou subdomínio dele. Sem usuário, porta nem IP."""
    p = urllib.parse.urlsplit(url)
    if p.scheme != "https" or not p.hostname or p.username or p.password:
        return False
    if p.port not in (None, 443):
        return False
    h = p.hostname.lower()
    if h.replace(".", "").isdigit() or ":" in h:  # IP literal
        return False
    return any(h == x or h.endswith("." + x) for x in (y.lower() for y in hosts))


class _SemRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None  # nunca segue redirecionamento (SSRF para outro host)


# Último pedido por host, compartilhado no processo: a taxa vale entre jobs, não só dentro de um.
_ULTIMO_POR_HOST: dict[str, float] = {}


class ClienteHttp:
    def __init__(
        self,
        user_agent: str,
        hosts: list[str],
        requisicoes_por_segundo: float = 2.0,
        dormir: Callable[[float], None] = time.sleep,
        monotonico: Callable[[], float] = time.monotonic,
        ultimo_por_host: dict[str, float] | None = None,
    ) -> None:
        self._ua = user_agent
        self._hosts = hosts
        self._intervalo = 1.0 / max(requisicoes_por_segundo, 0.1)
        self._dormir = dormir
        self._mono = monotonico
        self._ultimo = _ULTIMO_POR_HOST if ultimo_por_host is None else ultimo_por_host
        self._abridor = urllib.request.build_opener(_SemRedirect)

    def _esperar_vez(self, url: str) -> None:
        host = urllib.parse.urlsplit(url).hostname or ""
        falta = self._intervalo - (self._mono() - self._ultimo.get(host, -1e9))
        if falta > 0:
            self._dormir(falta)
        self._ultimo[host] = self._mono()

    def get_bytes(self, url: str, limite: int) -> bytes:
        """Baixa arquivo (https, host permitido, sem redirecionar); acima de `limite` é recusado."""
        if not host_permitido(url, self._hosts):
            raise ErroPermanente("host não permitido")
        espera = 1.0
        ultimo_erro = "sem resposta"
        for tentativa in range(TENTATIVAS):
            self._esperar_vez(url)
            req = urllib.request.Request(url, headers={"User-Agent": self._ua})  # noqa: S310
            try:
                with self._abridor.open(req, timeout=60) as r:
                    declarado = int(r.headers.get("Content-Length") or 0)
                    if declarado > limite:
                        raise ErroPermanente("arquivo maior que o limite")
                    corpo = r.read(limite + 1)
                if len(corpo) > limite:
                    raise ErroPermanente("arquivo maior que o limite")
                return bytes(corpo)
            except urllib.error.HTTPError as e:
                if e.code == 429 or e.code >= 500:
                    ultimo_erro = f"http {e.code}"
                else:
                    raise ErroPermanente(f"http {e.code}") from e
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                ultimo_erro = type(e).__name__
            if tentativa < TENTATIVAS - 1:
                self._dormir(min(espera, 30.0))
                espera *= 2
        raise ErroTransitorio(ultimo_erro)

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        if not host_permitido(url, self._hosts):
            raise ErroPermanente("host não permitido")
        if params:
            url = (
                url
                + "?"
                + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
            )
        espera = 1.0
        ultimo_erro = "sem resposta"
        for tentativa in range(TENTATIVAS):
            self._esperar_vez(url)
            req = urllib.request.Request(  # noqa: S310 - https e host conferidos acima
                url, headers={"User-Agent": self._ua, "Accept": "application/json"}
            )
            try:
                with self._abridor.open(req, timeout=30) as r:
                    corpo = r.read(20 * 1024 * 1024)
                if not corpo.strip():  # 204: consulta sem resultado
                    return None
                return json.loads(corpo, parse_float=Decimal)  # dinheiro nunca vira float
            except urllib.error.HTTPError as e:
                if e.code == 429 or e.code >= 500:
                    ultimo_erro = f"http {e.code}"
                    retry = e.headers.get("Retry-After", "") if e.headers else ""
                    espera = float(retry) if retry.isdigit() else espera
                elif 300 <= e.code < 400:
                    raise ErroPermanente("redirecionamento recusado") from e
                else:
                    raise ErroPermanente(f"http {e.code}") from e
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                ultimo_erro = type(e).__name__
            except ValueError as e:  # JSON inválido
                ultimo_erro = "json inválido"
                log.warning("resposta inválida", extra={"ctx": {"erro": type(e).__name__}})
            if tentativa < TENTATIVAS - 1:
                self._dormir(min(espera, 30.0))
                espera *= 2
        raise ErroTransitorio(ultimo_erro)
