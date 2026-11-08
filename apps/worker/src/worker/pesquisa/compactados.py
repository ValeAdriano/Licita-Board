"""Anexos compactados de edital (Fase 04, decisão 6): extração segura de ZIP; RAR e 7z pendentes.

O ZIP é conteúdo hostil (T3): nada é gravado em disco, nada é executado. Duas passagens:

1. `inspecionar` valida o ZIP inteiro antes de entregar qualquer arquivo: quantidade, nomes (sem
   caminho absoluto, `..`, link simbólico nem dispositivo), senha, método de compressão e, lendo em
   streaming e contando os bytes reais (o tamanho declarado no cabeçalho não vale), tamanho por
   arquivo, tamanho total e razão de compressão. Um limite estourado recusa o ZIP **inteiro**: não
   há extração parcial.
2. `ler` relê cada arquivo aprovado, com os mesmos limites, para o fluxo normal (tipo real,
   antivírus, SHA-256, S3, texto). Só o nome base é usado; o caminho interno só serve para
   a validação.

Profundidade 1: um compactado dentro do ZIP não é aberto (quem chama marca "compactado: pendente").
Texto dos arquivos é dado, nunca instrução (regra 16).
"""

import io
import lzma
import re
import stat
import unicodedata
import zipfile
import zlib
from collections.abc import Iterator
from dataclasses import dataclass, field

# Tipos reais (python-magic) tratados como compactado. DOCX/XLSX/ODT também são ZIP por dentro, mas
# o magic os reconhece pelo tipo próprio e eles seguem como documento.
ZIP = "application/zip"
COMPACTADOS = frozenset(
    {
        ZIP,
        "application/x-zip-compressed",
        "application/x-rar",
        "application/vnd.rar",
        "application/x-7z-compressed",
    }
)
_MB = 1024 * 1024
BLOCO = 64 * 1024
# Abaixo disso a razão de compressão não é cobrada: arquivo pequeno não é bomba (um texto de 20 KB
# de espaços passa de 100:1 sem risco algum).
PISO_RAZAO = 1 * _MB
_METODOS = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED, zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA}
_ERROS_LEITURA = (
    zipfile.BadZipFile,
    zlib.error,
    lzma.LZMAError,
    EOFError,
    OSError,
    ValueError,
    NotImplementedError,
)


@dataclass(frozen=True)
class Limites:
    """Padrões conservadores (configuráveis por VV_ZIP_*)."""

    max_arquivos: int = 50
    max_total: int = 200 * _MB  # descompactado, soma de todos
    max_arquivo: int = 50 * _MB  # descompactado, por arquivo
    max_razao: int = 100  # descompactado / compactado, por arquivo


@dataclass
class Inspecao:
    status: str  # extraido | pendente | recusado
    motivo: str | None = None
    entradas: list[tuple[zipfile.ZipInfo, str]] = field(default_factory=list)  # (info, nome base)


class CompactadoRecusadoError(Exception):
    """Limite estourado na releitura (não deveria acontecer depois da inspeção)."""


def nome_base(info: zipfile.ZipInfo) -> str | None:
    """Nome base seguro para exibir; None = perigoso (caminho absoluto, `..`, unidade, vazio)."""
    bruto = info.filename
    # Sem a flag UTF-8 (0x800), o zipfile decodifica em cp437; ZIP do Windows em português é cp850.
    if not info.flag_bits & 0x800:
        try:
            bruto = bruto.encode("cp437").decode("cp850")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    caminho = bruto.replace("\\", "/")
    if "\x00" in info.orig_filename or caminho.startswith("/") or re.match(r"^[A-Za-z]:", caminho):
        return None
    partes = [p for p in caminho.split("/") if p not in ("", ".")]
    if any(p == ".." for p in partes):
        return None
    if not partes:
        return None
    nome = unicodedata.normalize("NFC", partes[-1])
    nome = "".join(c for c in nome if unicodedata.category(c)[0] != "C").strip()
    if not nome or nome in (".", ".."):
        return None
    if len(nome) > 200:  # cabe em `titulo`; preserva a extensão
        base, ponto, ext = nome.rpartition(".")
        nome = (base[:190] + "." + ext[:9]) if ponto and len(ext) <= 9 else nome[:200]
    return nome


def _modo_unix(info: zipfile.ZipInfo) -> int:
    return (info.external_attr >> 16) & 0xFFFF if info.create_system == 3 else 0


def _ler_contando(
    z: zipfile.ZipFile, info: zipfile.ZipInfo, lim: Limites, guardar: bool
) -> tuple[int, bytes]:
    """Lê em blocos e para assim que um limite estoura (bytes reais, não o cabeçalho)."""
    lidos = 0
    partes: list[bytes] = []
    teto_razao = lim.max_razao * max(info.compress_size, 1)
    with z.open(info) as f:
        while bloco := f.read(BLOCO):
            lidos += len(bloco)
            if lidos > lim.max_arquivo:
                raise CompactadoRecusadoError(
                    f"arquivo interno acima de {lim.max_arquivo // _MB} MB descompactado"
                )
            if lidos > PISO_RAZAO and lidos > teto_razao:
                raise CompactadoRecusadoError(
                    f"razão de compressão acima de {lim.max_razao}:1 (possível bomba de ZIP)"
                )
            if guardar:
                partes.append(bloco)
    return lidos, b"".join(partes)


def inspecionar(dados: bytes, lim: Limites = Limites()) -> Inspecao:  # noqa: B008, PLR0911, PLR0912
    try:
        z = zipfile.ZipFile(io.BytesIO(dados))
    except (zipfile.BadZipFile, OSError, ValueError, EOFError):
        return Inspecao("recusado", "ZIP corrompido ou ilegível")
    with z:
        infos = z.infolist()
        arquivos = [i for i in infos if not i.is_dir()]
        if len(arquivos) > lim.max_arquivos or len(infos) > 4 * lim.max_arquivos:
            return Inspecao("recusado", f"mais de {lim.max_arquivos} arquivos no ZIP")
        if not arquivos:
            return Inspecao("recusado", "ZIP sem arquivos")
        entradas: list[tuple[zipfile.ZipInfo, str]] = []
        for i in infos:
            nome = nome_base(i)
            if nome is None:
                return Inspecao(
                    "recusado", "nome de arquivo inseguro no ZIP (caminho absoluto ou '..')"
                )
            # Sem bits de tipo (só permissões, comum) conta como arquivo comum.
            formato = stat.S_IFMT(_modo_unix(i))
            if formato not in (0, stat.S_IFREG, stat.S_IFDIR):
                tipo = "link simbólico" if formato == stat.S_IFLNK else "arquivo especial"
                return Inspecao("recusado", f"{tipo} dentro do ZIP")
            if not i.is_dir():
                entradas.append((i, nome))
        if any(i.flag_bits & 0x1 for i, _ in entradas):
            return Inspecao("pendente", "protegido por senha")
        if any(i.compress_type not in _METODOS for i, _ in entradas):
            return Inspecao("pendente", "método de compressão não suportado")
        # Corte rápido pelo cabeçalho (só para recusar; aceitar depende dos bytes reais, abaixo).
        if any(i.file_size > lim.max_arquivo for i, _ in entradas):
            return Inspecao(
                "recusado", f"arquivo interno acima de {lim.max_arquivo // _MB} MB descompactado"
            )
        total = 0
        for i, _ in entradas:
            try:
                total += _ler_contando(z, i, lim, guardar=False)[0]
            except CompactadoRecusadoError as e:
                return Inspecao("recusado", str(e))
            except _ERROS_LEITURA:
                return Inspecao("recusado", "ZIP corrompido ou ilegível")
            if total > lim.max_total:
                return Inspecao(
                    "recusado", f"conteúdo acima de {lim.max_total // _MB} MB descompactado"
                )
    return Inspecao("extraido", None, entradas)


def ler(dados: bytes, inspecao: Inspecao, lim: Limites = Limites()) -> Iterator[tuple[str, bytes]]:  # noqa: B008
    """(nome base, conteúdo) de cada arquivo aprovado; os limites valem de novo na releitura."""
    if inspecao.status != "extraido":
        return
    total = 0
    with zipfile.ZipFile(io.BytesIO(dados)) as z:
        for info, nome in inspecao.entradas:
            try:
                _, conteudo = _ler_contando(z, info, lim, guardar=True)
            except _ERROS_LEITURA as e:
                raise CompactadoRecusadoError("ZIP corrompido ou ilegível") from e
            total += len(conteudo)
            if total > lim.max_total:
                raise CompactadoRecusadoError(
                    f"conteúdo acima de {lim.max_total // _MB} MB descompactado"
                )
            yield nome, conteudo
