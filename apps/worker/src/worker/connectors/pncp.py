"""Conector PNCP (Fase 04): API pública de consulta.

Cada compra vira dados normalizados (puro, testável com fixtures gravadas); a rede fica atrás de
`Http`. Campos conferidos contra a API real em 2026-11-04.
"""

import hashlib
import json
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from worker.pesquisa.http import ErroPermanente

FUSO = ZoneInfo("America/Sao_Paulo")
BASE = "https://pncp.gov.br"
CONSULTA = f"{BASE}/api/consulta/v1/contratacoes"
DETALHE = f"{BASE}/api/pncp/v1/orgaos"
CONSULTA_ORGAOS = f"{BASE}/api/consulta/v1/orgaos"
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
        # orçamento sigiloso (código diferente de 1 = "sem sigilo"): não guardamos o valor
        "valor_estimado": None
        if raw.get("orcamentoSigilosoCodigo") not in (None, 1)
        else _dec(raw.get("valorTotalEstimado")),
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


@dataclass(frozen=True)
class ResultadoItem:
    id_externo: str
    numero_item: int
    fornecedor_tipo: str
    fornecedor_cnpj: str | None
    fornecedor_nome: str | None
    fornecedor_porte: str | None
    beneficio_me_epp: bool | None
    marca: str | None
    modelo: str | None
    quantidade: Decimal | None
    unidade_medida: str | None
    valor_unitario: Decimal | None
    valor_total: Decimal | None
    percentual_desconto: Decimal | None
    classificacao: int | None
    data_resultado: datetime | None
    situacao: str
    cancelado: bool

    def conteudo(self) -> dict[str, Any]:
        return {
            "id_externo": self.id_externo,
            "numero_item": self.numero_item,
            "fornecedor_tipo": self.fornecedor_tipo,
            "fornecedor_cnpj": self.fornecedor_cnpj,
            "fornecedor_nome": self.fornecedor_nome,
            "fornecedor_porte": self.fornecedor_porte,
            "beneficio_me_epp": self.beneficio_me_epp,
            "marca": self.marca,
            "modelo": self.modelo,
            "quantidade": self.quantidade,
            "unidade_medida": self.unidade_medida,
            "valor_unitario": self.valor_unitario,
            "valor_total": self.valor_total,
            "percentual_desconto": self.percentual_desconto,
            "classificacao": self.classificacao,
            "data_resultado": self.data_resultado.isoformat() if self.data_resultado else None,
            "situacao": self.situacao,
            "cancelado": self.cancelado,
        }

    def hash(self) -> str:
        return hashlib.sha256(dumps(self.conteudo()).encode()).hexdigest()


_TIPO_PESSOA = {"PJ": "pj", "PF": "pessoa_fisica", "PE": "estrangeiro"}


def normalizar_resultado(
    id_externo_compra: str,
    numero_item: int,
    unidade_medida: str | None,
    raw: dict[str, Any],
) -> ResultadoItem:
    """Normaliza um resultado de item do PNCP sem guardar dados pessoais de PF (LGPD / RF-07.10)."""
    seq = int(raw.get("sequencialResultado") or 1)
    tp_raw = str(raw.get("tipoPessoa") or raw.get("tipoPessoaId") or "").strip().upper()
    fornecedor_tipo = _TIPO_PESSOA.get(tp_raw, "nao_informado")

    fornecedor_cnpj: str | None = None
    fornecedor_nome: str | None = None
    if fornecedor_tipo == "pj":
        ni = re.sub(r"[^0-9A-Za-z]", "", str(raw.get("niFornecedor") or "")).upper()
        if len(ni) == 14:
            fornecedor_cnpj = ni
        fornecedor_nome = _texto(raw.get("nomeRazaoSocialFornecedor"), 300)
    elif fornecedor_tipo == "estrangeiro":
        fornecedor_nome = _texto(raw.get("nomeRazaoSocialFornecedor"), 300)
    # Se pessoa_fisica ou nao_informado: fornecedor_cnpj e fornecedor_nome permanecem None (CA-8).

    situacao = _texto(raw.get("situacaoCompraItemResultadoNome"), 80) or "Informado"
    cancelado = bool(raw.get("dataCancelamento")) or "cancelad" in situacao.lower()
    benef = raw.get("aplicacaoBeneficioMeEpp")
    beneficio_me_epp = bool(benef) if isinstance(benef, bool) else None
    ordem = raw.get("ordemClassificacaoSrp")
    classificacao = int(ordem) if ordem is not None and int(ordem) >= 1 else None
    data_str = raw.get("dataResultado") or raw.get("dataInclusao")
    iso_str = (
        f"{data_str}T00:00:00" if isinstance(data_str, str) and len(data_str) == 10 else data_str
    )
    data_res = _data(iso_str)

    return ResultadoItem(
        id_externo=f"{id_externo_compra}:{numero_item}:{seq}",
        numero_item=numero_item,
        fornecedor_tipo=fornecedor_tipo,
        fornecedor_cnpj=fornecedor_cnpj,
        fornecedor_nome=fornecedor_nome,
        fornecedor_porte=_texto(raw.get("porteFornecedorNome"), 60),
        beneficio_me_epp=beneficio_me_epp,
        marca=_texto(raw.get("marcaFornecedor") or raw.get("marca"), 120),
        modelo=_texto(raw.get("modeloFornecedor") or raw.get("modelo"), 120),
        quantidade=_dec(raw.get("quantidadeHomologada")),
        unidade_medida=_texto(unidade_medida, 60),
        valor_unitario=_dec(raw.get("valorUnitarioHomologado")),
        valor_total=_dec(raw.get("valorTotalHomologado")),
        percentual_desconto=_dec(raw.get("percentualDesconto")),
        classificacao=classificacao,
        data_resultado=data_res,
        situacao=situacao,
        cancelado=cancelado,
    )


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

    def compra_por_endereco(self, cnpj: str, ano: int, sequencial: int) -> Compra | None:
        """Uma compra pelo identificador (importação manual); None se a fonte não a conhece."""
        try:
            raw = self._http.get_json(f"{CONSULTA_ORGAOS}/{cnpj}/compras/{ano}/{sequencial}")
        except ErroPermanente:  # 4xx da fonte = não encontrada; falha de rede propaga
            return None
        return normalizar_compra(raw) if raw else None

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

    def listar_resultados_item(
        self,
        endereco: tuple[str, int, int],
        numero_item: int,
        id_externo_compra: str,
        unidade_medida: str | None,
    ) -> list[ResultadoItem]:
        """Busca resultados homologados de um item da compra no PNCP."""
        cnpj, ano, sequencial = endereco
        url = f"{DETALHE}/{cnpj}/compras/{ano}/{sequencial}/itens/{numero_item}/resultados"
        try:
            lote = self._http.get_json(url) or []
        except ErroPermanente:
            return []
        if not isinstance(lote, list):
            return []
        return [
            normalizar_resultado(id_externo_compra, numero_item, unidade_medida, r)
            for r in lote
            if isinstance(r, dict)
        ]
