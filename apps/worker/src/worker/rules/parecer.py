"""Conferência de EVIDÊNCIA do parecer de viabilidade recursal (Fase 10, 10.4). Código puro: sem I/O nem relógio.

Não decide mérito jurídico (⚖️ critérios de classificação são do jurídico): só confere que o que a pessoa (ou a IA) afirma tem prova.
Bloqueia: achado FORTE sem prova ou sem fundamento reconhecido na base jurídica verificada; fundamento que cita fonte fora da base; achado
da IA classificado forte cuja citação não está no texto da concorrente; recomendação "recorrer" sem achado forte/moderado com prova.
Avisa (não bloqueia): achado sem classificação, citação não conferida, sem recomendação, base vazia.
"""

from dataclasses import dataclass
from typing import Any

from worker.rules.citacoes import Entrada, nao_localizadas, verificar


@dataclass(frozen=True)
class Achado:
    id: str
    origem: str  # 'ia' | 'manual'
    descricao: str
    classificacao: str | None = None  # forte | moderada | fraca
    prova: str | None = None
    fundamento: str | None = None
    citacao_concorrente: str | None = None
    concorrente_confere: bool = False
    citacao_edital: str | None = None
    edital_confere: bool = False


def _item(codigo: str, mensagem: str, bloqueia: bool) -> dict[str, Any]:
    return {"codigo": codigo, "mensagem": mensagem, "bloqueia": bloqueia}


def validar(
    achados: list[Achado], recomendacao: str | None, base: list[Entrada]
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n, a in enumerate(achados, 1):
        rotulo = f"Achado {n} (“{a.descricao[:60]}”)"
        forte = a.classificacao == "forte"
        if forte and not (a.prova or "").strip():
            out.append(
                _item(
                    "forte_sem_prova",
                    f"{rotulo}: classificado como FORTE sem a prova (documento e página).",
                    True,
                )
            )
        if forte and not any(c.localizada for c in verificar(a.fundamento or "", base)):
            out.append(
                _item(
                    "forte_sem_fundamento",
                    f"{rotulo}: classificado como FORTE sem fundamento reconhecido na base jurídica verificada.",
                    True,
                )
            )
        for c in nao_localizadas(a.fundamento or "", base):
            out.append(
                _item(
                    "fundamento_fora_da_base",
                    f"{rotulo}: fundamento cita fonte fora da base verificada: “{c.trecho}”.",
                    True,
                )
            )
        if forte and a.origem == "ia" and not a.concorrente_confere:
            out.append(
                _item(
                    "forte_ia_sem_citacao",
                    f"{rotulo}: sugerido pela IA e classificado como FORTE, mas a citação não foi localizada no texto da concorrente.",
                    True,
                )
            )
        elif a.citacao_concorrente and not a.concorrente_confere:
            out.append(
                _item(
                    "citacao_nao_conferida",
                    f"{rotulo}: o trecho citado da concorrente não foi localizado no texto inserido.",
                    False,
                )
            )
        if a.citacao_edital and not a.edital_confere:
            out.append(
                _item(
                    "edital_nao_conferido",
                    f"{rotulo}: a cláusula citada do edital não foi localizada no texto do edital.",
                    False,
                )
            )
        if a.classificacao is None:
            out.append(
                _item(
                    "sem_classificacao",
                    f"{rotulo}: ainda sem classificação (forte, moderada ou fraca).",
                    False,
                )
            )
    solidos = [
        a for a in achados if a.classificacao in ("forte", "moderada") and (a.prova or "").strip()
    ]
    if recomendacao == "recorrer" and not solidos:
        out.append(
            _item(
                "recorrer_sem_achado",
                "Recomendação “recorrer” exige ao menos um achado forte ou moderado com prova.",
                True,
            )
        )
    if recomendacao is None:
        out.append(
            _item(
                "sem_recomendacao",
                "O parecer ainda não tem recomendação (recorrer, não recorrer ou apenas registrar).",
                False,
            )
        )
    if not base:
        out.append(
            _item(
                "base_vazia",
                "A base jurídica verificada da empresa está vazia: nenhum fundamento é aceito como forte.",
                False,
            )
        )
    return out


def bloqueia(divergencias: list[dict[str, Any]]) -> bool:
    return any(d["bloqueia"] for d in divergencias)
