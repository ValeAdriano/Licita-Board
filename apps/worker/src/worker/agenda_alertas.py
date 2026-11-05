"""Alertas da agenda e "Prazo perdido" (Fase 05, RF-05.7 e RF-05.12). Roda a cada hora no consumidor leve.

Idempotente: um alerta por (evento, marco, usuário) gravado em `priv.agenda_alertas`; a notificação e o e-mail só saem
quando a linha é nova, então repetir a rodada (ou um worker que reinicia) nunca duplica. O relógio entra por parâmetro.
Prazo PROVISÓRIO (abertura ainda não confirmada) alerta, mas nunca é marcado como perdido: a data-base é um palpite.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.rules.alertas import (
    ABERTOS,
    FUSO,
    deve_escalonar,
    dias_restantes,
    marco_atingido,
    rotulo_marco,
)

log = logging.getLogger("worker.agenda_alertas")

TIPO = {
    "disputa": "Disputa", "esclarecimento": "Pedido de esclarecimento", "impugnacao": "Impugnação",
    "resposta_administracao": "Resposta da Administração", "intencao_recurso": "Intenção de recurso",
    "razoes_recurso": "Razões de recurso", "contrarrazoes": "Contrarrazões",
    "regularizacao_fiscal_me_epp": "Regularização fiscal ME/EPP", "alteracao_edital": "Alteração do edital",
    "documento_vence": "Documento vence antes da disputa",
}  # fmt: skip
# Disputa é data de sessão e documento_vence é aviso: nenhum "perde o prazo" (não há protocolo a fazer).
SEM_PERDA = ("disputa", "documento_vence")
EMAIL_EM = {
    "D-1",
    "D0",
    "escalonado",
    "perdido",
}  # nos demais marcos só notificação e push (sem encher a caixa)


@dataclass
class Resumo:
    perdidos: int = 0
    alertas: int = 0
    escalonados: int = 0
    emails: int = 0


def destinatarios(
    conn: psycopg.Connection[Any], cache: dict[Any, dict[str, list[Any]]], empresa: Any
) -> dict[str, list[Any]]:
    """Quem recebe: todos com agenda/visualizar (menos CLIENTE) e, à parte, os gestores (ADMIN_EMPRESA ou agenda/aprovar)."""
    if empresa not in cache:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "select u.id, v.papel, exists (select 1 from core.permissoes p where p.vinculo_id = v.id "
                "and p.modulo = 'agenda' and p.acao = 'aprovar') as aprova "
                "from core.vinculos v join core.usuarios u on u.id = v.usuario_id and u.ativo and u.deleted_at is null "
                "join core.permissoes pv on pv.vinculo_id = v.id and pv.modulo = 'agenda' and pv.acao = 'visualizar' "
                "where v.empresa_id = %s and v.ativo and v.deleted_at is null and v.papel <> 'CLIENTE'",
                (empresa,),
            )
            linhas = cur.fetchall()
        cache[empresa] = {
            "todos": list({r["id"] for r in linhas}),
            "gestores": list(
                {r["id"] for r in linhas if r["papel"] == "ADMIN_EMPRESA" or r["aprova"]}
            ),
        }
    return cache[empresa]


def _avisar(
    conn: psycopg.Connection[Any],
    ev: dict[str, Any],
    usuario: Any,
    marco: str,
    titulo: str,
    corpo: str,
    tipo: str,
    r: Resumo,
) -> bool:
    cur = conn.execute(
        "insert into priv.agenda_alertas (empresa_id, evento_id, usuario_id, marco) values (%s, %s, %s, %s) "
        "on conflict (evento_id, marco, usuario_id) do nothing",
        (ev["empresa_id"], ev["id"], usuario, marco),
    )
    if cur.rowcount == 0:
        return False  # já avisado
    conn.execute(
        "insert into core.notificacoes (usuario_id, empresa_id, modulo, tipo, titulo, corpo, link) "
        "values (%s, %s, 'agenda', %s, %s, %s, %s)",
        (
            usuario,
            ev["empresa_id"],
            tipo,
            titulo,
            corpo[:1000],
            f"/agenda/acompanhamentos/{ev['acompanhamento_id']}",
        ),
    )
    r.alertas += 1
    if marco in EMAIL_EM:
        conn.execute(
            "select ops.enfileirar_pesquisa('email_agenda', %s, %s::jsonb, %s)",
            (
                ev["empresa_id"],
                f'{{"usuario_id": "{usuario}", "evento_id": "{ev["id"]}", "marco": "{marco}"}}',
                f"agenda:{ev['id']}:{marco}:{usuario}",
            ),
        )
        r.emails += 1
    return True


def _corpo(ev: dict[str, Any], prefixo: str = "") -> str:
    limite = ev["data_limite_legal"].astimezone(FUSO)
    prov = " (prazo provisório: abertura não confirmada)" if ev["provisorio"] else ""
    return f"{prefixo}{TIPO.get(ev['tipo'], ev['tipo'])} · {ev['orgao']} · {'abertura' if ev['tipo'] == 'disputa' else 'limite'} {limite:%d/%m/%Y %H:%M}{prov}"


def processar(conn: psycopg.Connection[Any], agora: datetime) -> Resumo:
    r = Resumo()
    cache: dict[Any, dict[str, list[Any]]] = {}
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select ev.id, ev.empresa_id, ev.acompanhamento_id, ev.tipo, ev.status, ev.data_limite_legal, ev.provisorio, "
            "ev.responsavel_id, a.responsavel_id as acomp_responsavel, g.razao_social as orgao "
            "from priv.agenda_eventos ev join priv.acompanhamentos a on a.id = ev.acompanhamento_id and a.deleted_at is null "
            "and a.status not in ('encerrado', 'desistiu') join pub.editais e on e.id = a.edital_id join pub.orgaos g on g.id = e.orgao_id "
            "where ev.status = any(%s) and ev.data_limite_legal is not null",
            (list(ABERTOS),),
        )
        eventos = cur.fetchall()
    for ev in eventos:
        dias = dias_restantes(ev["data_limite_legal"], agora)
        ds = destinatarios(conn, cache, ev["empresa_id"])
        responsaveis = [u for u in {ev["responsavel_id"], ev["acomp_responsavel"]} if u]
        if (
            dias < 0
            and ev["tipo"] not in SEM_PERDA
            and not ev["provisorio"]
            and ev["data_limite_legal"] < agora
        ):
            conn.execute(
                "update priv.agenda_eventos set status = 'prazo_perdido' where id = %s", (ev["id"],)
            )
            conn.execute(
                "insert into priv.agenda_evento_historico (empresa_id, evento_id, campo, antes, depois, motivo) "
                "values (%s, %s, 'status', %s, 'prazo_perdido', 'prazo vencido sem protocolo (marcado pelo sistema)')",
                (ev["empresa_id"], ev["id"], ev["status"]),
            )
            r.perdidos += 1
            for u in {*ds["gestores"], *responsaveis}:
                _avisar(conn, ev, u, "perdido", "Prazo perdido", _corpo(ev), "agenda_perdido", r)
            continue
        if dias < 0:
            continue
        marco = marco_atingido(dias)
        if marco is not None:
            m = rotulo_marco(marco)
            titulo = ("Disputa" if ev["tipo"] == "disputa" else "Prazo") + (
                " hoje" if marco == 0 else f" em {dias} dia(s)"
            )
            for u in {*ds["todos"], *responsaveis}:
                _avisar(conn, ev, u, m, titulo, _corpo(ev), "agenda_prazo", r)
        if ev["tipo"] != "disputa" and deve_escalonar(ev["status"], dias):
            for u in ds["gestores"]:
                novo = _avisar(
                    conn,
                    ev,
                    u,
                    "escalonado",
                    f"Sem andamento: prazo em {dias} dia(s)",
                    _corpo(ev, "Ninguém avançou este prazo. "),
                    "agenda_escalonado",
                    r,
                )
                if novo:
                    r.escalonados += 1
    conn.commit()
    log.info(
        "alertas da agenda",
        extra={"ctx": {"perdidos": r.perdidos, "alertas": r.alertas, "escalonados": r.escalonados}},
    )
    return r
