import { useState } from 'react'
import { Link } from 'react-router'
import { chamar } from '../../api/cliente'
import { Aviso, Botao, Campo, Etiqueta, Legenda, Selecao, Vazio } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'
import { dataHoraSP, TIPO_EVENTO, type Acompanhado, type EventoAgenda } from '../agenda/comum'
import { STATUS_PECA, TIPO_PECA, type PecaLinha } from './tipos'

const TIPOS_EVENTO = ['esclarecimento', 'impugnacao', 'intencao_recurso', 'razoes_recurso', 'contrarrazoes']

// Peças jurídicas da empresa, com o prazo vindo da agenda (esclarecimento, impugnação, intenção de recurso, razões, contrarrazões).
export function Pecas({ empresaId }: { empresaId: string }) {
  const { pode } = useAcesso()
  const lista = useGet<PecaLinha[]>(`/empresas/${empresaId}/juridico/pecas`)
  const acomps = useGet<Acompanhado[]>(pode('agenda', 'visualizar') ? `/empresas/${empresaId}/agenda/acompanhamentos` : null)
  const [f, setF] = useState({ acomp: '', tipo: 'impugnacao', titulo: '', evento: '' })
  const eventos = useGet<EventoAgenda[]>(f.acomp ? `/empresas/${empresaId}/agenda/eventos?acompanhamento=${f.acomp}` : null)
  const { enviando, erro, enviar } = useEnvio()
  const evs = (eventos.dados ?? []).filter((e) => TIPOS_EVENTO.includes(e.tipo))
  return (
    <div className="flex flex-col gap-4">
      <Aviso texto={erro ?? lista.erro} />
      {pode('juridico', 'elaborar_peca') ? (
        <div className="grid grid-cols-1 gap-3 rounded-xl bg-secondary p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Selecao rotulo="Edital acompanhado" value={f.acomp} onChange={(v) => setF({ ...f, acomp: v, evento: '' })} vazio="Escolha" opcoes={(acomps.dados ?? []).map((a) => ({ valor: a.id, rotulo: `${a.orgao}${a.numeroEdital ? ` · nº ${a.numeroEdital}` : ''}`.slice(0, 80) }))} />
          <Selecao rotulo="Tipo de peça" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} opcoes={Object.entries(TIPO_PECA).map(([valor, rotulo]) => ({ valor, rotulo }))} />
          <Selecao rotulo="Prazo da agenda (opcional)" value={f.evento} onChange={(v) => setF({ ...f, evento: v })} vazio="Sem prazo ligado" opcoes={evs.map((e) => ({ valor: e.id, rotulo: `${TIPO_EVENTO[e.tipo] ?? e.tipo} · ${dataHoraSP(e.dataLimite)}` }))} />
          <Campo rotulo="Título" value={f.titulo} onChange={(v) => setF({ ...f, titulo: v })} maxLength={200} />
          <div><Botao carregando={enviando} disabled={!f.acomp || f.titulo.trim().length < 3} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/juridico/acompanhamentos/${f.acomp}/pecas`, { tipo: f.tipo, titulo: f.titulo.trim(), eventoId: f.evento || null }); setF({ ...f, titulo: '' }); lista.recarregar() })}>Criar peça</Botao></div>
        </div>
      ) : null}
      {(lista.dados ?? []).length === 0 && !lista.carregando ? <Vazio>Nenhuma peça ainda. Crie uma a partir de um edital acompanhado.</Vazio> : null}
      <div className="flex flex-col gap-2">
        {(lista.dados ?? []).map((p) => {
          const [rotulo, cor] = STATUS_PECA[p.status] ?? [p.status, 'cinza' as const]
          return (
            <Link key={p.id} to={`/juridico/pecas/${p.id}`} className="flex flex-col gap-1 rounded-xl bg-primary p-4 no-underline shadow-xs ring-1 ring-secondary hover:bg-primary_hover">
              <span className="flex flex-wrap items-center gap-2"><strong className="text-md text-primary [overflow-wrap:anywhere]"><bdi>{p.titulo}</bdi></strong><Etiqueta cor={cor}>{rotulo}</Etiqueta><Etiqueta cor="cinza">{TIPO_PECA[p.tipo] ?? p.tipo}</Etiqueta>{p.bloqueada && ['minuta', 'revisao'].includes(p.status) && p.validadaEm ? <Etiqueta cor="erro">Citação ou dado bloqueando</Etiqueta> : null}</span>
              <Legenda>{p.orgao ?? '—'}{p.numeroEdital ? ` · nº ${p.numeroEdital}` : ''}{p.prazoLegal ? ` · prazo legal ${dataHoraSP(p.prazoLegal)}` : ''}{p.protocoloNumero ? ` · protocolo ${p.protocoloNumero}` : ''}</Legenda>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
