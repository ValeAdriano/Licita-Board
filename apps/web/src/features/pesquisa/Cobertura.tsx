import { Aviso, Etiqueta } from '../../ui'
import { useGet } from '../acesso/useGet'
import { quando } from './formato'

interface Fonte { id: string; slug: string; nome: string; status: string; ativa: boolean; falhasConsecutivas: number; ultimoSucessoEm: string | null; ultimaPesquisaEm: string | null; ultimoResultado: string | null; horarios: string[]; checagensOk7d: number; checagensFalha7d: number }
interface Exec { id: string; fonte: string; tipo: string; status: string; agendadaPara: string; iniciadaEm: string | null; concluidaEm: string | null; processosEncontrados: number; editaisNovos: number; editaisAtualizados: number; itensPendentes: number; erroTipo: string | null }
interface Painel {
  fontes: Fonte[]; execucoes: Exec[]; amostraMedida: boolean
  totais: { editais: number; itens: number; arquivos: number; arquivosLiberados: number; arquivosPendentes: number; arquivosComProblema: number; arquivosProcessados: number; trechos: number }
  cobertura: { mes: string; total: number; encontrados: number }[]
}
const STATUS: Record<string, string> = { ok: 'OK', degradada: 'Degradada', indisponivel: 'Indisponível', desativada: 'Desligada', perdida: 'Perdida', falhou: 'Falhou', parcial: 'Parcial', agendada: 'Agendada', executando: 'Executando' }

// Painel de cobertura e falhas (Prompt 4.9), só da plataforma. Fonte indisponível aparece em destaque e a
// cobertura sem amostra é "não medida", nunca 100%.
export function Cobertura() {
  const p = useGet<Painel>('/plataforma/pesquisa/cobertura')
  if (p.erro) return <Aviso texto={p.erro} />
  if (!p.dados) return <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Carregando…</p>
  const { fontes, execucoes, totais, cobertura } = p.dados
  const card = (rotulo: string, valor: number | string) => (
    <div key={rotulo} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left flex-col items-start">
      <strong>{valor}</strong>
      <span className="text-sm text-tertiary [overflow-wrap:anywhere]">{rotulo}</span>
    </div>
  )
  return (
    <div className="flex flex-col gap-6">
      <h2>Fontes</h2>
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {fontes.map((f) => (
          <div key={f.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
              <strong>{f.nome}</strong>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">
                Última busca {quando(f.ultimaPesquisaEm)} · último sucesso {quando(f.ultimoSucessoEm)} · horários {f.horarios.join(', ')} · 7 dias: {f.checagensOk7d} ok, {f.checagensFalha7d} falhas
              </span>
              {f.ultimoResultado ? <span className="text-sm text-tertiary [overflow-wrap:anywhere]"><bdi>{f.ultimoResultado}</bdi></span> : null}
            </span>
            <Etiqueta cor={f.status === 'ok' ? 'cinza' : 'aviso'}>{f.ativa ? (STATUS[f.status] ?? f.status) : 'Desligada'}</Etiqueta>
          </div>
        ))}
      </div>
      <h2>O que já foi coletado</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        {card('Processos (editais)', totais.editais)}
        {card('Itens extraídos', totais.itens)}
        {card('Anexos encontrados', totais.arquivos)}
        {card('Anexos liberados', totais.arquivosLiberados)}
        {card('Anexos pendentes', totais.arquivosPendentes)}
        {card('Anexos com problema', totais.arquivosComProblema)}
        {card('Anexos com texto', totais.arquivosProcessados)}
        {card('Trechos de texto', totais.trechos)}
      </div>
      <h2>Cobertura contra a amostra de referência</h2>
      {cobertura.length === 0 ? (
        <Aviso tipo="info" texto="Não medida: ainda não há amostra de editais cadastrada (meta ≥ 95%). Nada aqui indica 100%." />
      ) : (
        <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
          {cobertura.map((c) => (
            <div key={c.mes} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]"><strong>{c.mes.slice(0, 7)}</strong><span className="legenda">{c.encontrados} de {c.total} encontrados</span></span>
              <Etiqueta cor={c.encontrados * 100 >= c.total * 95 ? 'cinza' : 'aviso'}>{c.total ? Math.floor((c.encontrados * 1000) / c.total) / 10 : 0}%</Etiqueta>
            </div>
          ))}
        </div>
      )}
      <h2>Execuções recentes</h2>
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {execucoes.map((x) => (
          <div key={x.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
              <strong>{x.fonte} · {x.tipo} · {quando(x.agendadaPara)}</strong>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">
                {x.processosEncontrados} processos, {x.editaisNovos} novos, {x.editaisAtualizados} atualizados, {x.itensPendentes} com erro{x.erroTipo ? ` · ${x.erroTipo}` : ''}
              </span>
            </span>
            <Etiqueta cor={x.status === 'ok' ? 'cinza' : 'aviso'}>{STATUS[x.status] ?? x.status}</Etiqueta>
          </div>
        ))}
      </div>
    </div>
  )
}
