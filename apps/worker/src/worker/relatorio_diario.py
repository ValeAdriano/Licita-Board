"""Relatório diário por e-mail (Fase 12, 12.2). Opt-in por pessoa e empresa; chega depois das 7h de Brasília.

Cada seção só entra se a pessoa AINDA tem a permissão do módulo de origem (o worker lê o banco sem RLS, então a conferência é explícita aqui).
O e-mail leva contagens, nomes públicos de órgão e links: nunca valor financeiro, custo, margem nem dado pessoal. Sem nada a relatar, não envia.
"""

import datetime as dt
import logging
from dataclasses import dataclass, field
from typing import Any

import psycopg
from psycopg.rows import dict_row

from worker.email import Mensagem

log = logging.getLogger("worker.relatorio_diario")
FUSO = dt.timezone(dt.timedelta(hours=-3))
JURIDICOS = ("esclarecimento", "impugnacao", "intencao_recurso", "razoes_recurso", "contrarrazoes")
ABERTOS = ("sugerido", "em_elaboracao", "em_revisao", "aprovado")
ROTULO_PRAZO = {
    "esclarecimento": "Pedido de esclarecimento", "impugnacao": "Impugnação", "intencao_recurso": "Intenção de recurso",
    "razoes_recurso": "Razões de recurso", "contrarrazoes": "Contrarrazões",
}  # fmt: skip


@dataclass
class Secao:
    titulo: str
    linhas: list[str] = field(default_factory=list)


def _dh(d: dt.datetime) -> str:
    return d.astimezone(FUSO).strftime("%d/%m %H:%M")


def permissoes(conn: psycopg.Connection[Any], usuario: Any, empresa: Any) -> set[tuple[str, str]]:
    with conn.cursor() as cur:
        cur.execute(
            "select p.modulo, p.acao from core.permissoes p join core.vinculos v on v.id = p.vinculo_id "
            "where v.usuario_id = %s and v.empresa_id = %s and v.ativo and v.deleted_at is null",
            (usuario, empresa),
        )
        return {(m, a) for m, a in cur.fetchall()}


def coletar(
    conn: psycopg.Connection[Any], usuario: Any, empresa: Any, agora: dt.datetime
) -> list[Secao]:
    """Seções com algo a relatar, só dos módulos que a pessoa pode ver."""
    pode = permissoes(conn, usuario, empresa)

    def ver(modulo: str) -> bool:
        return (modulo, "visualizar") in pode

    secoes: list[Secao] = []
    ate = agora + dt.timedelta(days=7)
    with conn.cursor(row_factory=dict_row) as cur:
        if ver("editais"):
            cur.execute(
                "select count(*) filter (where triagem = 'nova') as novas, "
                "count(*) filter (where triagem = 'nova' and created_at > %s) as novas_24h "
                "from priv.oportunidades where empresa_id = %s and not retirado",
                (agora - dt.timedelta(hours=24), empresa),
            )
            o = cur.fetchone() or {"novas": 0, "novas_24h": 0}
            cur.execute(
                "select g.razao_social as orgao, e.numero_edital, o.nota from priv.oportunidades o join pub.editais e on e.id = o.edital_id "
                "join pub.orgaos g on g.id = e.orgao_id where o.empresa_id = %s and not o.retirado and o.triagem = 'nova' and o.faixa = 'alta' "
                "order by o.nota desc, o.created_at desc limit 5",
                (empresa,),
            )
            prio = cur.fetchall()
            if o["novas"]:
                s = Secao(
                    "Oportunidades",
                    [
                        f"{o['novas']} oportunidade(s) nova(s) para triar ({o['novas_24h']} chegaram nas últimas 24 h)."
                    ],
                )
                s.linhas += [
                    f"Prioritária: {p['orgao']}{' · edital nº ' + p['numero_edital'] if p['numero_edital'] else ''} (nota {p['nota']})"
                    for p in prio
                ]
                secoes.append(s)
        if ver("agenda"):
            cur.execute(
                "select g.razao_social as orgao, a.data_abertura from priv.acompanhamentos a join pub.editais e on e.id = a.edital_id "
                "join pub.orgaos g on g.id = e.orgao_id where a.empresa_id = %s and a.deleted_at is null and a.status not in ('encerrado', 'desistiu') "
                "and a.data_abertura between %s and %s order by a.data_abertura limit 5",
                (empresa, agora, ate),
            )
            disputas = cur.fetchall()
            cur.execute(
                "select count(*) as n from priv.acompanhamentos a join pub.editais e on e.id = a.edital_id where a.empresa_id = %s and a.deleted_at is null "
                "and a.status not in ('encerrado', 'desistiu') and a.edital_versao_vista < e.versao_atual",
                (empresa,),
            )
            alterados = (cur.fetchone() or {"n": 0})["n"]
            cur.execute(
                "select ev.tipo, ev.data_limite_legal, g.razao_social as orgao from priv.agenda_eventos ev join priv.acompanhamentos a on a.id = ev.acompanhamento_id "
                "join pub.editais e on e.id = a.edital_id join pub.orgaos g on g.id = e.orgao_id where ev.empresa_id = %s and ev.tipo = any(%s) and ev.status = any(%s) "
                "and ev.data_limite_legal is not null and ev.data_limite_legal <= %s and a.deleted_at is null and a.status not in ('encerrado', 'desistiu') "
                "order by ev.data_limite_legal limit 10",
                (empresa, list(JURIDICOS), list(ABERTOS), ate),
            )
            prazos = cur.fetchall()
            if disputas:
                secoes.append(
                    Secao(
                        "Disputas nos próximos 7 dias",
                        [f"{d['orgao']} · {_dh(d['data_abertura'])}" for d in disputas],
                    )
                )
            if alterados:
                secoes.append(
                    Secao(
                        "Editais alterados",
                        [
                            f"{alterados} edital(is) acompanhado(s) foram retificados e ainda não conferidos."
                        ],
                    )
                )
            if prazos:
                secoes.append(Secao("Prazos jurídicos (próximos 7 dias e vencidos)", [
                    f"{'VENCIDO · ' if p['data_limite_legal'] < agora else ''}{ROTULO_PRAZO.get(p['tipo'], p['tipo'])} · {p['orgao']} · {_dh(p['data_limite_legal'])}" for p in prazos
                ]))  # fmt: skip
        if ver("juridico"):
            cur.execute(
                "select count(*) as n from priv.sugestoes_pecas where empresa_id = %s and status = 'nova'",
                (empresa,),
            )
            sug = (cur.fetchone() or {"n": 0})["n"]
            cur.execute(
                "select count(*) as n from priv.pecas where empresa_id = %s and status = 'revisao'",
                (empresa,),
            )
            rev = (cur.fetchone() or {"n": 0})["n"]
            linhas = ([f"{sug} peça(s) sugerida(s) pela IA aguardando decisão."] if sug else []) + (
                [f"{rev} peça(s) em revisão aguardando aprovação."] if rev else []
            )
            if linhas:
                secoes.append(Secao("Jurídico", linhas))
        pend: list[str] = []
        if ver("propostas"):
            cur.execute(
                "select count(*) as n from priv.propostas where empresa_id = %s and deleted_at is null and status in ('rascunho', 'conferencia', 'aprovada')",
                (empresa,),
            )
            n = (cur.fetchone() or {"n": 0})["n"]
            pend += [f"{n} proposta(s) pendente(s)."] if n else []
        if ver("analises"):
            cur.execute(
                "select count(*) as n from priv.analises_item where empresa_id = %s and (resumo is null or resumo = 'PENDENTE')",
                (empresa,),
            )
            n = (cur.fetchone() or {"n": 0})["n"]
            pend += [f"{n} análise(s) técnica(s) pendente(s)."] if n else []
        if ver("documentos"):
            cur.execute("select vencidos, a_vencer from priv.resumo_documentos(%s)", (empresa,))
            d = cur.fetchone() or {"vencidos": 0, "a_vencer": 0}
            pend += [f"{d['vencidos']} documento(s) vencido(s)."] if d["vencidos"] else []
            pend += [f"{d['a_vencer']} documento(s) vencendo em breve."] if d["a_vencer"] else []
        if pend:
            secoes.append(Secao("Pendências", pend))
        if ver("contratos"):
            cur.execute(
                "select count(*) as n from priv.contrato_notificacoes where empresa_id = %s and created_at > %s and tipo <> 'contrato_a_cadastrar'",
                (empresa, agora - dt.timedelta(hours=24)),
            )
            n = (cur.fetchone() or {"n": 0})["n"]
            cur.execute("select priv.contratadas_sem_contrato(%s) as n", (empresa,))
            c = (cur.fetchone() or {"n": 0})["n"]
            linhas = (
                [f"{n} novo(s) alerta(s) de vigência, garantia, entrega ou pagamento."] if n else []
            ) + ([f"{c} resultado(s) contratado(s) sem contrato cadastrado."] if c else [])
            if linhas:
                secoes.append(Secao("Contratos", linhas))
        if ver("editais"):
            cur.execute(
                "select nome, status from ops.fontes where ativa and status in ('degradada', 'indisponivel') order by nome limit 5"
            )
            fontes = cur.fetchall()
            cur.execute(
                "select count(*) as n from pub.edital_arquivos where status_extracao = 'falhou' and updated_at > %s",
                (agora - dt.timedelta(hours=24),),
            )
            falhas = (cur.fetchone() or {"n": 0})["n"]
            linhas = [f"Fonte {f['nome']}: {f['status']}." for f in fontes] + (
                [f"{falhas} arquivo(s) de edital com falha de leitura nas últimas 24 h."]
                if falhas
                else []
            )
            if linhas:
                secoes.append(Secao("Saúde da pesquisa", linhas))
    return secoes


def compor(para: str, empresa: str, secoes: list[Secao], hoje: dt.date, app_url: str) -> Mensagem:
    corpo = "\n\n".join(
        f"{s.titulo}\n" + "\n".join(f"  - {linha}" for linha in s.linhas) for s in secoes
    )
    texto = (
        f"Resumo do dia para {empresa} ({hoje:%d/%m/%Y}).\n\n{corpo}\n\n"
        f"Abra o VV Licitações: {app_url.rstrip('/')}/\n"
        "Os prazos seguem regras ainda em validação pelo jurídico: confira sempre o edital.\n"
        "Para parar de receber este resumo, desligue-o no Início (Relatório diário por e-mail).\n"
    )
    return Mensagem(para=para, assunto=f"Relatório diário · {empresa} · {hoje:%d/%m}", texto=texto)


def enfileirar(conn: psycopg.Connection[Any], hoje: dt.date) -> int:
    n = conn.execute("select priv.enfileirar_relatorios_diarios(%s)", (hoje,)).fetchone()
    conn.commit()
    return int(n[0]) if n else 0
