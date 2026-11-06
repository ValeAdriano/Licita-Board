#!/usr/bin/env python3
"""Confere a entrega de um worker antes de integrar no main (docs/agents/orquestracao.md).

Repete sobre o DIFF as checagens que o hook do Claude Code (.claude/hooks/guard.py) faz
antes de cada edição. Necessário porque Antigravity, Codex e outros agentes não passam
pelo hook. Também aponta o que pede atenção do orquestrador.

Uso (na worktree do worker):
    python3 scripts/conferir-entrega.py [base]      # base padrão: main

Compara o merge-base com a árvore de trabalho (inclui o que não foi commitado e arquivos novos).
Saída: linhas BLOQUEIO / AVISO. Código 1 se houver BLOQUEIO, 0 caso contrário.
Sem dependências externas.
"""

from __future__ import annotations

import importlib.util
import re
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath

RAIZ = Path(__file__).resolve().parent.parent

# Arquivos de estado compartilhado: só o orquestrador escreve (orquestracao.md §5).
ESTADO_COMPARTILHADO = {
    "docs/agents/COMECE-AQUI.md",
    "docs/agents/em-andamento.md",
    "docs/roadmap.md",
    "docs/agents/fila.md",
}
# Áreas do tier A (orquestracao.md §2): aviso para o orquestrador conferir com atenção.
AREAS_TIER_A = (
    "db/migrations/",
    "apps/worker/src/worker/rules/",
    "infra/",
    "apps/api/src/auth",
    "apps/api/src/sessao",
    "apps/api/src/permiss",
    "apps/web/src/auth/",
    "scripts/criar-usuario",
)
DEPENDENCIAS = ("package.json", "package-lock.json", "pyproject.toml", "uv.lock", "requirements")
TABELA_PRIV = re.compile(r"create\s+table\s+(if\s+not\s+exists\s+)?priv\.", re.IGNORECASE)
LIMITE_LINHAS = 500


def carregar_guard():
    caminho = RAIZ / ".claude" / "hooks" / "guard.py"
    spec = importlib.util.spec_from_file_location("guard", caminho)
    if spec is None or spec.loader is None:
        sys.exit(f"não consegui carregar {caminho}")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


def git(*args: str) -> str:
    resultado = subprocess.run(["git", "-C", str(RAIZ), *args], capture_output=True, text=True, check=False)
    if resultado.returncode != 0:
        sys.exit(f"git {' '.join(args)} falhou: {resultado.stderr.strip()}")
    return resultado.stdout


def existe_em(ref: str, caminho: str) -> bool:
    r = subprocess.run(["git", "-C", str(RAIZ), "cat-file", "-e", f"{ref}:{caminho}"], capture_output=True, check=False)
    return r.returncode == 0


def linhas_adicionadas(base: str) -> tuple[dict[str, str], dict[str, str], int]:
    """Devolve ({arquivo: texto adicionado}, {arquivo: status A/M/D/R}, total de linhas alteradas)."""
    status: dict[str, str] = {}
    for linha in git("diff", "--name-status", base).splitlines():
        partes = linha.split("\t")
        status[partes[-1]] = partes[0][0]
    for novo in git("ls-files", "--others", "--exclude-standard").splitlines():
        status[novo] = "A"

    adicionado: dict[str, list[str]] = {}
    atual = None
    total = 0
    for linha in git("diff", "-U0", "--no-color", base).splitlines():
        if linha.startswith("+++ "):
            atual = linha[6:] if linha.startswith("+++ b/") else None
        elif linha.startswith("--- "):
            continue
        elif atual and linha.startswith("+"):
            adicionado.setdefault(atual, []).append(linha[1:])
            total += 1
        elif linha.startswith("-"):
            total += 1
    for caminho, st in status.items():
        if st == "A" and caminho not in adicionado and (RAIZ / caminho).is_file():
            try:
                texto = (RAIZ / caminho).read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            adicionado[caminho] = texto.splitlines()
            total += len(adicionado[caminho])
    return {k: "\n".join(v) for k, v in adicionado.items()}, status, total


def main() -> int:
    base_ref = sys.argv[1] if len(sys.argv) > 1 else "main"
    guard = carregar_guard()
    base = git("merge-base", base_ref, "HEAD").strip()
    adicionado, status, total = linhas_adicionadas(base)

    bloqueios: list[str] = []
    avisos: list[str] = []

    for caminho, st in sorted(status.items()):
        nome = PurePosixPath(caminho).name
        texto = adicionado.get(caminho, "")

        if re.fullmatch(r"\.env(\..+)?", nome) and not nome.endswith((".example", ".sample")):
            bloqueios.append(f"{caminho}: arquivo de segredos alterado")
        if caminho in ESTADO_COMPARTILHADO:
            bloqueios.append(f"{caminho}: estado compartilhado é do orquestrador; descreva na nota de entrega")
        if caminho.startswith(("apps/web/", "packages/shared/")) and guard.SECRET_IN_APP.search(texto):
            bloqueios.append(f"{caminho}: credencial de banco/S3/chave-mestra no front (bundle público)")
        eh_teste = re.search(r"(\.spec\.ts|\.e2e-spec\.ts)$", caminho) or caminho.startswith("apps/api/test/")
        if caminho.startswith("apps/api/") and not eh_teste and guard.SECRET_IN_API.search(texto):
            bloqueios.append(f"{caminho}: credencial de vv_worker/vv_owner na API")
        if caminho.startswith(guard.MIGRATION_DIRS) and caminho.endswith(".sql"):
            if st in {"M", "D", "R"} and existe_em(base, caminho):
                bloqueios.append(f"{caminho}: migration já aplicada no main é imutável; crie uma nova")
            if guard.RLS_OFF.search(texto):
                bloqueios.append(f"{caminho}: desliga RLS ou cria policy using(true)")
            if TABELA_PRIV.search(texto):
                avisos.append(f"{caminho}: tabela nova em priv; precisa de teste A x B antes de uso real (regra 13)")
        if caminho.startswith("apps/worker/src/worker/rules/") and guard.FLOAT_MONEY.search(texto):
            bloqueios.append(f"{caminho}: float em rules/; use decimal.Decimal")
        if caminho.startswith(AREAS_TIER_A):
            avisos.append(f"{caminho}: área do tier A; confira o diff deste arquivo")
        if nome.startswith(DEPENDENCIAS):
            avisos.append(f"{caminho}: dependência mudou; o commit precisa de nome, versão, licença e motivo (regra 7)")

    if total > LIMITE_LINHAS:
        avisos.append(f"entrega com {total} linhas alteradas (> {LIMITE_LINHAS}); considere dividir")

    if any(c.startswith("db/") for c in status):
        r = subprocess.run([sys.executable, str(RAIZ / "scripts" / "check_isolation_coverage.py")],
                           cwd=RAIZ, capture_output=True, text=True, check=False)
        if r.returncode != 0:
            avisos.append("check_isolation_coverage.py falhou: " + (r.stdout + r.stderr).strip().splitlines()[-1])

    if shutil.which("semgrep"):
        alterados = [c for c in status if status[c] != "D" and (RAIZ / c).is_file()]
        if alterados:
            r = subprocess.run(["semgrep", "scan", "--config", ".semgrep/", "--error", "--quiet", *alterados],
                               cwd=RAIZ, capture_output=True, text=True, check=False)
            if r.returncode != 0:
                bloqueios.append("semgrep (regras do projeto) encontrou problemas:\n" + r.stdout.strip())
    else:
        avisos.append("semgrep não instalado; regras de .semgrep/ não foram conferidas")

    print(f"conferir-entrega: {len(status)} arquivo(s), {total} linha(s) alterada(s) desde {base[:8]}")
    for b in bloqueios:
        print(f"BLOQUEIO  {b}")
    for a in avisos:
        print(f"AVISO     {a}")
    if not bloqueios and not avisos:
        print("ok")
    return 1 if bloqueios else 0


if __name__ == "__main__":
    sys.exit(main())
