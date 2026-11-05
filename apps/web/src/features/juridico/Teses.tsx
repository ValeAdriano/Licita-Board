import { useState } from 'react'
import { chamar } from '../../api/cliente'
import { Aviso, AreaTexto, Botao, Campo, Cartao, Etiqueta, Legenda, Selecao, Vazio } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'
import { TIPO_PECA } from './tipos'

interface Tese { id: string; tipo: string; titulo: string; texto: string; status: string; validacao: { codigo: string; mensagem: string; bloqueia: boolean }[] | null; validadaEm: string | null; bloqueada: boolean; aprovadaPor: string | null; usos: number; respondidas: number; deferidas: number; indeferidas: number }
const STATUS: Record<string, ['cinza' | 'sucesso' | 'aviso', string]> = { rascunho: ['aviso', 'Rascunho'], aprovada: ['sucesso', 'Aprovada'], arquivada: ['cinza', 'Arquivada'] }

// Banco de teses (10.8): argumento reutilizável por tipo de peça. Só vira "aprovada" depois que o sistema confere que o texto não cita nada fora
// da base jurídica verificada e que quem aprova peças a aprova. O sistema registra uso e resultado; não julga qual tese é boa.
export function Teses({ empresaId }: { empresaId: string }) {
  const { pode } = useAcesso()
  const lista = useGet<Tese[]>(`/empresas/${empresaId}/juridico/teses`)
  const { enviando, erro, enviar } = useEnvio()
  const [n, setN] = useState({ tipo: 'impugnacao', titulo: '', texto: '' })
  const base = `/empresas/${empresaId}/juridico/teses`
  return (
    <div className="flex flex-col gap-4">
      <Aviso texto={erro ?? lista.erro} />
      <Legenda>Teses aprovadas aparecem na peça do mesmo tipo e alimentam a minuta por IA. Citação fora da base jurídica verificada bloqueia a aprovação. A taxa de deferimento é (deferido + parcialmente deferido) ÷ peças respondidas que usaram a tese. (EM DESENVOLVIMENTO)</Legenda>
      {pode('juridico', 'elaborar_peca') ? (
        <Cartao><h2>Nova tese</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Selecao rotulo="Tipo de peça" value={n.tipo} onChange={(v) => setN({ ...n, tipo: v })} opcoes={Object.entries(TIPO_PECA).map(([valor, rotulo]) => ({ valor, rotulo }))} /><Campo rotulo="Título" value={n.titulo} onChange={(v) => setN({ ...n, titulo: v })} maxLength={200} /></div>
          <AreaTexto rotulo="Texto do argumento (cite só fontes da base verificada)" value={n.texto} onChange={(v) => setN({ ...n, texto: v })} rows={5} maxLength={4000} />
          <div><Botao carregando={enviando} disabled={n.titulo.trim().length < 3 || n.texto.trim().length < 20} onClick={() => void enviar(async () => { await chamar('POST', base, { tipo: n.tipo, titulo: n.titulo.trim(), texto: n.texto.trim() }); setN({ ...n, titulo: '', texto: '' }); lista.recarregar() })}>Criar tese</Botao></div></Cartao>
      ) : null}
      {(lista.dados ?? []).length === 0 && !lista.carregando ? <Vazio>Nenhuma tese ainda.</Vazio> : null}
      {(lista.dados ?? []).map((t) => <Item key={t.id + t.status + (t.validadaEm ?? '')} t={t} base={base} enviando={enviando} enviar={enviar} recarregar={lista.recarregar} />)}
    </div>
  )
}

function Item({ t, base, enviando, enviar, recarregar }: { t: Tese; base: string; enviando: boolean; enviar: (fn: () => Promise<void>) => Promise<unknown>; recarregar: () => void }) {
  const { pode } = useAcesso()
  const [ed, setEd] = useState({ titulo: t.titulo, texto: t.texto })
  const [cor, rotulo] = STATUS[t.status] ?? ['cinza' as const, t.status]
  const bloqueios = (t.validacao ?? []).filter((x) => x.bloqueia)
  const taxa = t.respondidas > 0 ? `${((100 * t.deferidas) / t.respondidas).toFixed(1).replace('.', ',')}%` : '—'
  return (
    <Cartao>
      <span className="flex flex-wrap items-center gap-2"><strong className="[overflow-wrap:anywhere]"><bdi>{t.titulo}</bdi></strong><Etiqueta cor="cinza">{TIPO_PECA[t.tipo] ?? t.tipo}</Etiqueta><Etiqueta cor={cor}>{rotulo}</Etiqueta>{t.bloqueada && t.validadaEm ? <Etiqueta cor="erro">Citação fora da base</Etiqueta> : null}{t.validadaEm === null && t.status === 'rascunho' ? <Etiqueta cor="cinza">Conferindo…</Etiqueta> : null}</span>
      <Legenda>Usos: {t.usos} · respondidas: {t.respondidas} · deferidas: {t.deferidas} · indeferidas: {t.indeferidas} · taxa de deferimento: {taxa}{t.aprovadaPor ? ` · aprovada por ${t.aprovadaPor}` : ''}</Legenda>
      {bloqueios.length ? <ul className="list-disc pl-5 text-sm text-error-primary">{bloqueios.map((b) => <li key={b.mensagem} className="[overflow-wrap:anywhere]">{b.mensagem}</li>)}</ul> : null}
      {pode('juridico', 'elaborar_peca') && t.status !== 'arquivada' ? <>
        <Campo rotulo="Título" value={ed.titulo} onChange={(v) => setEd({ ...ed, titulo: v })} maxLength={200} />
        <AreaTexto rotulo="Texto" value={ed.texto} onChange={(v) => setEd({ ...ed, texto: v })} rows={4} maxLength={4000} />
      </> : <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]"><bdi>{t.texto}</bdi></p>}
      <div className="flex flex-wrap gap-3">
        {pode('juridico', 'elaborar_peca') && t.status !== 'arquivada' ? <Botao variante="secundario" carregando={enviando} disabled={ed.titulo.trim().length < 3 || ed.texto.trim().length < 20 || (ed.titulo === t.titulo && ed.texto === t.texto)} onClick={() => void enviar(async () => { await chamar('PUT', `${base}/${t.id}`, { titulo: ed.titulo.trim(), texto: ed.texto.trim() }); recarregar() })}>Salvar (volta a rascunho)</Botao> : null}
        {pode('juridico', 'aprovar_peca') && t.status === 'rascunho' ? <Botao carregando={enviando} disabled={t.bloqueada || t.validadaEm === null} onClick={() => void enviar(async () => { await chamar('POST', `${base}/${t.id}/aprovar`); recarregar() })}>Aprovar tese</Botao> : null}
        {pode('juridico', 'aprovar_peca') && t.status !== 'arquivada' ? <Botao variante="texto" carregando={enviando} onClick={() => void enviar(async () => { await chamar('POST', `${base}/${t.id}/arquivar`); recarregar() })}>Arquivar</Botao> : null}
      </div>
    </Cartao>
  )
}
