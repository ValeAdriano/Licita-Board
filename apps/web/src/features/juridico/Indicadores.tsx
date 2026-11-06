import { useState } from 'react'
import { Aviso, Botao, Cartao, Legenda, Selecao } from '../../ui'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'
import { TIPO_PECA } from './tipos'

interface Ind {
  ano: number | null; sugeridas: number; elaboradas: number; protocoladas: number; respondidas: number; deferidas: number; indeferidas: number; revertidasPorRecurso: number; prazosCumpridos: number; prazosPerdidos: number
  porTipo: { tipo: string; elaboradas: number; protocoladas: number; respondidas: number; deferidas: number; parciais: number; indeferidas: number; taxa: string | null }[]
  porTese: { id: string; titulo: string; tipo: string; usos: number; respondidas: number; deferidas: number; indeferidas: number; taxa: string | null }[]
}
const pct = (t: string | null) => (t === null ? '—' : `${t.replace('.', ',')}%`)

// Indicadores do jurídico (10.9): contagens diretas dos registros da empresa; nada é estimado.
export function Indicadores({ empresaId }: { empresaId: string }) {
  const [ano, setAno] = useState('')
  const d = useGet<Ind>(`/empresas/${empresaId}/juridico/indicadores${ano ? `?ano=${ano}` : ''}`)
  const [anos] = useState(() => Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i)))
  const { pode } = useAcesso()
  const i = d.dados
  return (
    <div className="flex flex-col gap-4">
      <Aviso texto={d.erro} />
      <div className="nao-imprimir flex flex-wrap items-end gap-3">
        <div className="max-w-xs"><Selecao rotulo="Período" value={ano} onChange={setAno} vazio="Todos os anos" opcoes={anos.map((a) => ({ valor: a, rotulo: a }))} /></div>
        {pode('juridico', 'exportar') ? <Botao variante="secundario" onClick={() => window.location.assign(`/api/empresas/${empresaId}/juridico/indicadores.xlsx${ano ? `?ano=${ano}` : ''}`)}>Exportar (Excel)</Botao> : null}
        <Botao variante="texto" onClick={() => window.print()}>Salvar em PDF (imprimir)</Botao>
      </div>
      {i ? <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {([['Peças sugeridas', i.sugeridas], ['Peças elaboradas', i.elaboradas], ['Peças protocoladas', i.protocoladas], ['Respondidas', i.respondidas], ['Deferidas (total ou parcial)', i.deferidas], ['Indeferidas', i.indeferidas], ['Prazos cumpridos', i.prazosCumpridos], ['Prazos perdidos', i.prazosPerdidos]] as [string, number][]).map(([r, v]) => (
            <Cartao key={r}><Legenda>{r}</Legenda><strong className="text-display-xs">{v}</strong></Cartao>
          ))}
          <Cartao><Legenda>Licitações revertidas por recurso</Legenda><strong className="text-display-xs">{i.revertidasPorRecurso}</strong></Cartao>
        </div>
        <Cartao><h2>Por tipo de peça</h2>
          <Legenda>Taxa de deferimento = (deferido + parcialmente deferido) ÷ peças respondidas.</Legenda>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Tipo</th><th>Elaboradas</th><th>Protocoladas</th><th>Respondidas</th><th>Deferidas</th><th>Parciais</th><th>Indeferidas</th><th>Taxa</th></tr></thead>
            <tbody>{i.porTipo.map((t) => <tr key={t.tipo}><td>{TIPO_PECA[t.tipo] ?? t.tipo}</td><td>{t.elaboradas}</td><td>{t.protocoladas}</td><td>{t.respondidas}</td><td>{t.deferidas}</td><td>{t.parciais}</td><td>{t.indeferidas}</td><td>{pct(t.taxa)}</td></tr>)}</tbody></table></div>
        </Cartao>
        <Cartao><h2>Por tese</h2>
          {i.porTese.length === 0 ? <Legenda>Nenhuma tese usada em peça ainda.</Legenda> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Tese</th><th>Tipo</th><th>Usos</th><th>Respondidas</th><th>Deferidas</th><th>Indeferidas</th><th>Taxa</th></tr></thead>
            <tbody>{i.porTese.map((t) => <tr key={t.id}><td><bdi>{t.titulo}</bdi></td><td>{TIPO_PECA[t.tipo] ?? t.tipo}</td><td>{t.usos}</td><td>{t.respondidas}</td><td>{t.deferidas}</td><td>{t.indeferidas}</td><td>{pct(t.taxa)}</td></tr>)}</tbody></table></div>}
        </Cartao>
      </> : null}
    </div>
  )
}
