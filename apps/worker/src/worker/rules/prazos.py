"""Cálculo de prazos da agenda (Fase 05). Código puro: sem I/O, sem banco, sem IA, sem relógio.

⚖️ VALIDAR JURÍDICO (spec fase-05 §4.3 e pergunta 4): a convenção de contagem abaixo é a PROVISÓRIA do projeto
até o jurídico VV entregar a tabela de regras e os 30+ casos:
  * dia útil = nem sábado, nem domingo, nem feriado/ponto facultativo do local do órgão;
  * a contagem EXCLUI o dia do começo (o primeiro dia contado é o dia útil seguinte/anterior);
  * "N dias úteis antes da abertura" conta para trás a partir da data da abertura;
  * o limite é o fim do dia (23:59 de Brasília), salvo horário do portal informado por quem cadastra;
  * prazo fixado pelo edital prevalece sobre a regra, com a cláusula.
A data interna recomendada fica N dias úteis (padrão 2) antes do limite. Todo resultado diz que regra usou e traz
avisos (ex.: "passou por ponto facultativo contado como não útil").
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

FUSO = ZoneInfo("America/Sao_Paulo")
FIM_DO_DIA = time(23, 59)
HORA_INTERNA = time(18, 0)


@dataclass(frozen=True)
class Regra:
    evento: str
    base: str
    quantidade: int
    unidade: str  # dias_uteis | imediato
    sentido: str  # antes | depois
    artigo: str
    limite_superior: str | None = None
    prorrogavel: bool = False
    validada: bool = False


@dataclass(frozen=True)
class Resultado:
    limite: datetime
    interna: datetime
    origem: str  # regra | edital
    artigo: str
    clausula: str | None = None
    avisos: tuple[str, ...] = field(default_factory=tuple)


def eh_dia_util(d: date, nao_uteis: Mapping[date, str]) -> bool:
    return d.weekday() < 5 and d not in nao_uteis


def deslocar_dias_uteis(
    inicio: date, n: int, sentido: str, nao_uteis: Mapping[date, str]
) -> tuple[date, list[str]]:
    """Anda `n` dias úteis a partir de `inicio` (excluído), para a frente ou para trás.
    Devolve a data e os avisos dos feriados/pontos facultativos pulados em dia de semana."""
    passo = 1 if sentido == "depois" else -1
    d, contados, avisos = inicio, 0, []
    while contados < n:
        d += timedelta(days=passo)
        if eh_dia_util(d, nao_uteis):
            contados += 1
        elif d.weekday() < 5:
            avisos.append(f"{d:%d/%m/%Y} não contou como dia útil ({nao_uteis[d]})")
    return d, avisos


def _fim_do_dia(d: date) -> datetime:
    return datetime.combine(d, FIM_DO_DIA, tzinfo=FUSO)


def calcular(
    regra: Regra,
    base: datetime,
    nao_uteis: Mapping[date, str],
    abertura: datetime | None = None,
    prazo_edital: datetime | None = None,
    clausula: str | None = None,
    dias_internos: int = 2,
) -> Resultado:
    """Data-limite e data interna recomendada de UM evento."""
    base_local = base.astimezone(FUSO)
    avisos: list[str] = []
    if regra.unidade == "imediato":
        limite = base_local
    else:
        dia, avisos = deslocar_dias_uteis(
            base_local.date(), regra.quantidade, regra.sentido, nao_uteis
        )
        limite = _fim_do_dia(dia)
        if regra.limite_superior == "ultimo_dia_util_antes_abertura":
            if abertura is None:
                avisos.append(
                    "sem data de abertura confirmada: limite superior da regra não aplicado"
                )
            else:
                teto, _ = deslocar_dias_uteis(
                    abertura.astimezone(FUSO).date(), 1, "antes", nao_uteis
                )
                if _fim_do_dia(teto) < limite:
                    limite = _fim_do_dia(teto)
                    avisos.append("limitado ao último dia útil antes da abertura")
    origem, usado = "regra", regra.artigo
    if prazo_edital is not None:
        limite, origem, usado = prazo_edital.astimezone(FUSO), "edital", "Prazo fixado pelo edital"
        avisos = []
    if regra.unidade == "imediato" and prazo_edital is None:
        interna = limite
    else:
        d_int, _ = deslocar_dias_uteis(limite.date(), dias_internos, "antes", nao_uteis)
        interna = datetime.combine(d_int, HORA_INTERNA, tzinfo=FUSO)
    return Resultado(
        limite, interna, origem, usado, clausula if origem == "edital" else None, tuple(avisos)
    )
