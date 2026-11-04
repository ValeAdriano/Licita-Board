"""Conector PNCP (Fase 04): API pública de consulta.

Cada compra vira dados normalizados (puro, testável com fixtures gravadas); a rede fica atrás de
`Http`. Campos conferidos contra a API real em 2026-11-04.
"""

import hashlib
import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any, Protocol
from zoneinfo import ZoneInfo

FUSO = ZoneInfo("America/Sao_Paulo")
BASE = "https://pncp.gov.br"
CONSULTA = f"{BASE}/api/consulta/v1/contratacoes"
DETALHE = f"{BASE}/api/pncp/v1/orgaos"
# Códigos de modalidade do PNCP (uma por chamada); ops.fontes.parametros pode trocar a lista.
MODALIDADES = list(range(1, 14))
TAMANHO_PAGINA = 50
_ESFERA = {"M": "municipal", "E": "estadual", "F": "federal", "D": "distrital"}
# ⚖️ VALIDAR JURÍDICO: código de benefício da fonte -> marcação interna (LC 123, art. 48).
# 1 exclusiva ME/EPP · 3 cota reservada · 4 sem benefício (ampla). 2 (subcontratação), 5 (não se
# aplica) e qualquer outro ficam "nao_informado": nunca deduzimos benefício.
_BENEFICIO = {1: "exclusivo_me_epp", 3: "cota_reservada", 4: "ampla_concorrencia"}
_TIPO_ARQUIVO = (
    ("termo de refer", "termo_referencia"),
    ("estudo t", "etp"),
    ("retifica", "retificacao"),
    ("aviso", "aviso"),
    ("planilha", "planilha"),
    ("edital", "edital"),
)
MAX_ITENS_NO_CONTEUDO = 500


class Http(Protocol):
    def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any: ...


def _dec(v: Any) -> Decimal | None:
    return None if v is None else Decimal(str(v)).quantize(Decimal("0.0001"))


def _data(v: str | None) -> datetime | None:
    """A fonte manda horário de Brasília sem fuso."""
    return None if not v else datetime.fromisoformat(v).replace(tzinfo=FUSO)


def _texto(v: Any, limite: int) -> str | None:
    return None if v is None else str(v).strip()[:limite] or None


@dataclass(frozen=True)
class Orgao:
    cnpj: str
    unidade_codigo: str
    razao_social: str
    esfera: str | None
    uf: str | None
    municipio: str | None
    codigo_ibge: str | None


@dataclass(frozen=True)
class Item:
    numero_item: int
    descricao: str
    quantidade: Decimal | None
    unidade_medida: str | None
    valor_unitario_estimado: Decimal | None
    valor_total_estimado: Decimal | None
    beneficio: str
    situacao: str | None
    criterio_julgamento: str | None


@dataclass(frozen=True)
class Arquivo:
    titulo: str | None
    url: str
    tipo: str


@dataclass(frozen=True)
class Compra:
    id_externo: str
    ano: int
    sequencial: int
    orgao: Orgao
    campos: dict[str, Any]  # colunas de pub.editais (sem ids nem controle de coleta)
    atualizacao_global: str | None
    itens: list[Item] = field(default_factory=list)
    arquivos: list[Arquivo] = field(default_factory=list)

    def conteudo(self) -> dict[str, Any]:
        """Cópia normalizada que vira `pub.edital_versoes.conteudo` e entra no hash."""
        itens = [i.__dict__ for i in self.itens[:MAX_ITENS_NO_CONTEUDO]]
        return {
            "id_externo": self.id_externo,
            "orgao": self.orgao.__dict__,
            "campos": self.campos,
            "itens": itens,
            "itens_total": len(self.itens),
            "arquivos": [a.__dict__ for a in self.arquivos],
        }

    def hash(self) -> str:
        return hashlib.sha256(dumps(self.conteudo()).encode()).hexdigest()


def dumps(obj: Any) -> str:
    return json.dumps(obj, default=str, ensure_ascii=False, sort_keys=True)


def normalizar_compra(raw: dict[str, Any]) -> Compra:
    o, u = raw["orgaoEntidade"], raw.get("unidadeOrgao") or {}
    cnpj, ano, seq = str(o["cnpj"]), int(raw["anoCompra"]), int(raw["sequencialCompra"])
    orgao = Orgao(
        cnpj=cnpj,
        unidade_codigo=str(u.get("codigoUnidade") or "0"),
        razao_social=str(o["razaoSocial"])[:300],
        esfera=_ESFERA.get(str(o.get("esferaId"))),
        uf=u.get("ufSigla"),
        municipio=_texto(u.get("municipioNome"), 120),
        codigo_ibge=str(u["codigoIbge"]) if u.get("codigoIbge") else None,
    )
    link_portal = raw.get("linkSistemaOrigem")
    campos = {
        "numero_edital": _texto(raw.get("numeroCompra"), 80),
        "processo": _texto(raw.get("processo"), 80),
        "modalidade": _texto(raw.get("modalidadeNome"), 80),
        "modo_disputa": _texto(raw.get("modoDisputaNome"), 80),
        "srp": bool(raw.get("srp")),
        "objeto": str(raw.get("objetoCompra") or "").strip()[:20000] or "(sem objeto informado)",
        "valor_estimado": _dec(raw.get("valorTotalEstimado")),
        "situacao": _texto(raw.get("situacaoCompraNome"), 80),
        "data_publicacao": _data(raw.get("dataPublicacaoPncp")),
        "data_abertura_propostas": _data(raw.get("dataAberturaProposta")),
        "data_encerramento_propostas": _data(raw.get("dataEncerramentoProposta")),
        # Data da sessão NÃO vem da fonte: não é deduzida (prazos legais saem dela, Fase 05).
        "data_sessao": None,
        "link_origem": f"{BASE}/app/editais/{cnpj}/{ano}/{seq}",
        "link_portal": link_portal
        if isinstance(link_portal, str) and link_portal.startswith("https://")
        else None,
    }
    return Compra(
        id_externo=str(raw["numeroControlePNCP"]),
        ano=ano,
        sequencial=seq,
        orgao=orgao,
        campos=campos,
        atualizacao_global=raw.get("dataAtualizacaoGlobal") or raw.get("dataAtualizacao"),
    )


def normalizar_item(raw: dict[str, Any]) -> Item:
    sigiloso = bool(raw.get("orcamentoSigiloso"))
    return Item(
        numero_item=int(raw["numeroItem"]),
        descricao=str(raw.get("descricao") or "").strip()[:20000] or "(sem descrição)",
        quantidade=_dec(raw.get("quantidade")),
        unidade_medida=_texto(raw.get("unidadeMedida"), 60),
        valor_unitario_estimado=None if sigiloso else _dec(raw.get("valorUnitarioEstimado")),
        valor_total_estimado=None if sigiloso else _dec(raw.get("valorTotal")),
        beneficio=_BENEFICIO.get(int(raw.get("tipoBeneficio") or 0), "nao_informado"),
        situacao=_texto(raw.get("situacaoCompraItemNome"), 80),
        criterio_julgamento=_texto(raw.get("criterioJulgamentoNome"), 80),
    )


def normalizar_arquivo(raw: dict[str, Any]) -> Arquivo | None:
    url = raw.get("url") or raw.get("uri")
    if (
        not isinstance(url, str)
        or not url.startswith("https://")
        or raw.get("statusAtivo") is False
    ):
        return None
    nome = str(raw.get("tipoDocumentoNome") or "").lower()
    tipo = next((t for trecho, t in _TIPO_ARQUIVO if trecho in nome), "anexo")
    return Arquivo(titulo=_texto(raw.get("titulo"), 300), url=url[:1000], tipo=tipo)


class ConectorPNCP:
    slug = "pncp"

    def __init__(self, http: Http) -> None:
        self._http = http

    def listar(
        self, endpoint: str, ini: str, fim: str, uf: str, modalidade: int
    ) -> Iterator[tuple[list[dict[str, Any]], dict[str, Any]]]:
        """Páginas da consulta (`publicacao` ou `atualizacao`), datas AAAAMMDD: (dados, meta)."""
        pagina = 1
        while True:
            r = (
                self._http.get_json(
                    f"{CONSULTA}/{endpoint}",
                    {
                        "dataInicial": ini,
                        "dataFinal": fim,
                        "codigoModalidadeContratacao": modalidade,
                        "uf": uf,
                        "pagina": pagina,
                        "tamanhoPagina": TAMANHO_PAGINA,
                    },
                )
                or {}
            )
            yield list(r.get("data") or []), {k: v for k, v in r.items() if k != "data"}
            if pagina >= int(r.get("totalPaginas") or 0):
                return
            pagina += 1

    def detalhar(self, compra: Compra) -> Compra:
        """Busca itens e arquivos da compra; falha de rede é de quem chama (isola o registro)."""
        base = f"{DETALHE}/{compra.orgao.cnpj}/compras/{compra.ano}/{compra.sequencial}"
        itens: list[Item] = []
        pagina = 1
        while True:
            lote = self._http.get_json(
                f"{base}/itens", {"pagina": pagina, "tamanhoPagina": TAMANHO_PAGINA}
            )
            itens += [normalizar_item(i) for i in lote]
            if len(lote) < TAMANHO_PAGINA:
                break
            pagina += 1
        arquivos = [
            a
            for r in (self._http.get_json(f"{base}/arquivos") or [])
            if (a := normalizar_arquivo(r))
        ]
        criterios = {i.criterio_julgamento for i in itens if i.criterio_julgamento}
        campos = {
            **compra.campos,
            "criterio_julgamento": criterios.pop() if len(criterios) == 1 else None,
        }
        return Compra(
            compra.id_externo,
            compra.ano,
            compra.sequencial,
            compra.orgao,
            campos,
            compra.atualizacao_global,
            itens,
            arquivos,
        )
