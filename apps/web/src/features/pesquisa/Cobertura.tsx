import { Aviso } from '../../ui'
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
  if (!p.dados) return <p className="legenda">Carregando…</p>
  const { fontes, execucoes, totais, cobertura } = p.dados
  const card = (rotulo: string, valor: number | string) => (
    <div key={rotulo} className="lista__item" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start' }}>
      <strong>{valor}</strong>
      <span className="legenda">{rotulo}</span>
    </div>
  )
  return (
    <div className="pilha pilha--grande">
      <h2>Fontes</h2>
      <div className="lista">
        {fontes.map((f) => (
          <div key={f.id} className="lista__item" style={{ cursor: 'default' }}>
            <span className="lista__texto">
              <strong>{f.nome}</strong>
              <span className="legenda">
                Última busca {quando(f.ultimaPesquisaEm)} · último sucesso {quando(f.ultimoSucessoEm)} · horários {f.horarios.join(', ')} · 7 dias: {f.checagensOk7d} ok, {f.checagensFalha7d} falhas
              </span>
              {f.ultimoResultado ? <span className="legenda"><bdi>{f.ultimoResultado}</bdi></span> : null}
            </span>
            <span className={f.status === 'ok' ? 'tag' : 'tag tag--aviso'}>{f.ativa ? (STATUS[f.status] ?? f.status) : 'Desligada'}</span>
          </div>
        ))}
      </div>
      <h2>O que já foi coletado</h2>
      <div className="lista" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
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
        <div className="lista">
          {cobertura.map((c) => (
            <div key={c.mes} className="lista__item" style={{ cursor: 'default' }}>
              <span className="lista__texto"><strong>{c.mes.slice(0, 7)}</strong><span className="legenda">{c.encontrados} de {c.total} encontrados</span></span>
              <span className={c.encontrados * 100 >= c.total * 95 ? 'tag' : 'tag tag--aviso'}>{c.total ? Math.floor((c.encontrados * 1000) / c.total) / 10 : 0}%</span>
            </div>
          ))}
        </div>
      )}
      <h2>Execuções recentes</h2>
      <div className="lista">
        {execucoes.map((x) => (
          <div key={x.id} className="lista__item" style={{ cursor: 'default' }}>
            <span className="lista__texto">
              <strong>{x.fonte} · {x.tipo} · {quando(x.agendadaPara)}</strong>
              <span className="legenda">
                {x.processosEncontrados} processos, {x.editaisNovos} novos, {x.editaisAtualizados} atualizados, {x.itensPendentes} com erro{x.erroTipo ? ` · ${x.erroTipo}` : ''}
              </span>
            </span>
            <span className={x.status === 'ok' ? 'tag' : 'tag tag--aviso'}>{STATUS[x.status] ?? x.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
