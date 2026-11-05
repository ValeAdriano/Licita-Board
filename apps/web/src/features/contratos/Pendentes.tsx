import { useState } from 'react'
import { useNavigate } from 'react-router'
import { chamar } from '../../api/cliente'
import { Aviso, Botao, Campo, Cartao, Legenda, Selecao } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useGet } from '../acesso/useGet'
import { reais } from '../precos/formato'

interface Linha { acompanhamentoId: string; participacaoId: string; orgao: string | null; numeroEdital: string | null; objeto: string | null; numeroItem: number | null; descricao: string | null; unidade: string | null; quantidade: string | null; valorFinal: string | null }
const DEC = /^\d{1,14}(\.\d{1,4})?$/
const paraDec = (v: string): string => v.trim().replace(',', '.')

// Resultados "contratada" que ainda não têm contrato: pré-preenche órgão, objeto e itens com os dados do edital. O sistema não inventa número,
// vigência nem valor unitário: quem cadastra informa o que está no contrato assinado (o valor final do resultado aparece só como referência).
export function Pendentes({ empresaId }: { empresaId: string }) {
  const lista = useGet<Linha[]>(`/empresas/${empresaId}/contratos/pendentes-de-cadastro`)
  const [aberto, setAberto] = useState<string | null>(null)
  const grupos = new Map<string, Linha[]>()
  for (const l of lista.dados ?? []) grupos.set(l.acompanhamentoId, [...(grupos.get(l.acompanhamentoId) ?? []), l])
  if (grupos.size === 0) return null
  return (
    <div className="flex flex-col gap-3">
      <Aviso tipo="atencao" texto={`${grupos.size} edital(is) contratado(s) ainda sem contrato cadastrado. Cadastre com os dados do contrato assinado.`} />
      {[...grupos.entries()].map(([ac, itens]) => (
        <Cartao key={ac}>
          <strong className="[overflow-wrap:anywhere]"><bdi>{itens[0]?.orgao ?? '—'}</bdi>{itens[0]?.numeroEdital ? ` · edital nº ${itens[0].numeroEdital}` : ''}</strong>
          <Legenda>{itens.length} item(ns) contratado(s)</Legenda>
          {aberto === ac ? <Formulario empresaId={empresaId} itens={itens} aoFechar={() => setAberto(null)} aoCriar={lista.recarregar} /> : <div><Botao variante="secundario" onClick={() => setAberto(ac)}>Cadastrar contrato com estes dados</Botao></div>}
        </Cartao>
      ))}
    </div>
  )
}

function Formulario({ empresaId, itens, aoFechar, aoCriar }: { empresaId: string; itens: Linha[]; aoFechar: () => void; aoCriar: () => void }) {
  const primeiro = itens[0]
  const [f, setF] = useState({ tipo: 'contrato', numero: '', orgao: primeiro?.orgao ?? '', objeto: primeiro?.objeto ?? '', ini: '', fim: '', gestor: '', fiscal: '' })
  const [valores, setValores] = useState<string[]>(itens.map(() => ''))
  const { enviando, erro, enviar } = useEnvio()
  const navegar = useNavigate()
  const itensOk = itens.every((_, i) => DEC.test(paraDec(valores[i] ?? '')) && Number(paraDec(valores[i] ?? '')) > 0)
  const valido = f.numero.trim() !== '' && f.orgao.trim().length >= 2 && f.objeto.trim().length >= 3 && f.ini !== '' && f.fim !== '' && f.fim >= f.ini && itensOk
  return (
    <div className="flex flex-col gap-3">
      <Aviso texto={erro} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Selecao rotulo="Tipo" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} opcoes={[{ valor: 'contrato', rotulo: 'Contrato' }, { valor: 'ata', rotulo: 'Ata de registro de preços' }]} />
        <Campo rotulo="Número" value={f.numero} onChange={(v) => setF({ ...f, numero: v })} maxLength={80} />
        <Campo rotulo="Órgão" value={f.orgao} onChange={(v) => setF({ ...f, orgao: v })} maxLength={200} />
        <Campo rotulo="Objeto" value={f.objeto} onChange={(v) => setF({ ...f, objeto: v })} maxLength={2000} />
        <Campo rotulo="Vigência: início" type="date" value={f.ini} onChange={(v) => setF({ ...f, ini: v })} />
        <Campo rotulo="Vigência: fim" type="date" value={f.fim} onChange={(v) => setF({ ...f, fim: v })} erro={f.fim !== '' && f.ini !== '' && f.fim < f.ini} />
        <Campo rotulo="Gestor (órgão)" value={f.gestor} onChange={(v) => setF({ ...f, gestor: v })} maxLength={200} />
        <Campo rotulo="Fiscal (órgão)" value={f.fiscal} onChange={(v) => setF({ ...f, fiscal: v })} maxLength={200} />
      </div>
      <h3>Itens do contrato</h3>
      {itens.map((it, i) => (
        <div key={it.participacaoId} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
          <span className="text-sm [overflow-wrap:anywhere] sm:col-span-2">Item {it.numeroItem ?? i + 1} · <bdi>{it.descricao ?? '—'}</bdi> · {it.quantidade ?? '—'} {it.unidade ?? ''}{it.valorFinal ? <><br />Valor final registrado no resultado: {reais(it.valorFinal)} (confira se é unitário ou total antes de informar o valor unitário do contrato)</> : null}</span>
          <Campo rotulo="Valor unitário do contrato (R$)" value={valores[i] ?? ''} onChange={(v) => setValores(valores.map((x, j) => (j === i ? v : x)))} inputMode="decimal" />
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        <Botao carregando={enviando} disabled={!valido} onClick={() => void enviar(async () => {
          const r = await chamar<{ id: string }>('POST', `/empresas/${empresaId}/contratos`, { tipo: f.tipo, numero: f.numero.trim(), orgao: f.orgao.trim(), objeto: f.objeto.trim(), vigenciaInicio: f.ini, vigenciaFim: f.fim, gestorOrgao: f.gestor.trim() || null, fiscalOrgao: f.fiscal.trim() || null, acompanhamentoId: primeiro?.acompanhamentoId })
          for (const [i, it] of itens.entries()) await chamar('POST', `/empresas/${empresaId}/contratos/${r.id}/itens`, { numeroItem: it.numeroItem ?? i + 1, descricao: (it.descricao ?? 'Item').slice(0, 2000), unidade: it.unidade, quantidade: it.quantidade && DEC.test(it.quantidade) ? it.quantidade : '1', valorUnitario: paraDec(valores[i] ?? '') })
          aoCriar()
          navegar(`/contratos/${r.id}`)
        })}>Cadastrar contrato e itens</Botao>
        <Botao variante="texto" onClick={aoFechar}>Cancelar</Botao>
      </div>
    </div>
  )
}
