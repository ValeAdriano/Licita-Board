import { useState, type FormEvent } from 'react'
import { chamar } from '../../../api/cliente'
import { Aviso, Botao, Campo } from '../../../ui'
import { Secao } from '../conta/Secao'
import { useEnvio } from '../conta/useEnvio'
import { useGet } from '../useGet'
import { opcoesUf, Selecao } from './comum'

interface Termo { id: string; tipo: string; termo: string; ativo: boolean }
interface Filtro { id: string; tipo: string; uf: string | null; municipio: string | null; valorMin: string | null; valorMax: string | null; texto: string | null }
const TIPOS = [
  { valor: 'palavra', rotulo: 'Palavra-chave' }, { valor: 'sinonimo', rotulo: 'Sinônimo' }, { valor: 'categoria', rotulo: 'Categoria' }, { valor: 'marca', rotulo: 'Marca' },
  { valor: 'modelo', rotulo: 'Modelo' }, { valor: 'relacionado', rotulo: 'Termo relacionado' }, { valor: 'exclusao', rotulo: 'Termo de exclusão' },
]
const TIPOS_FILTRO = [{ valor: 'uf', rotulo: 'Estado (UF)' }, { valor: 'municipio', rotulo: 'Município' }, { valor: 'faixa_valor', rotulo: 'Faixa de valor' }, { valor: 'restricao', rotulo: 'Restrição de fornecimento' }]
const rotuloFiltro = (x: Filtro) => x.tipo === 'uf' ? `UF ${x.uf}` : x.tipo === 'municipio' ? `${x.municipio}/${x.uf}` : x.tipo === 'faixa_valor' ? `R$ ${x.valorMin ?? '0'} a ${x.valorMax ?? 'sem limite'}` : (x.texto ?? '')

// Palavras-chave e filtros da empresa (Prompt 2.5): só cadastro. Termo de exclusão apenas REDUZ a nota
// de relevância (Fase 04); nunca elimina uma oportunidade.
export function PalavrasChave({ empresaId, pode }: { empresaId: string; pode: (acao: string) => boolean }) {
  const dados = useGet<{ termos: Termo[]; filtros: Filtro[] }>(`/empresas/${empresaId}/palavras-chave`)
  const [tipo, setTipo] = useState('palavra')
  const [termo, setTermo] = useState('')
  const [tf, setTf] = useState('uf')
  const [f, setF] = useState({ uf: 'SP', municipio: '', min: '', max: '', texto: '' })
  const a = useEnvio()
  const b = useEnvio()
  const incluir = (e: FormEvent) => {
    e.preventDefault()
    return a.enviar(async () => { await chamar('POST', `/empresas/${empresaId}/palavras-chave`, { tipo, termo: termo.trim() }); setTermo(''); dados.recarregar() })
  }
  const incluirFiltro = (e: FormEvent) => {
    e.preventDefault()
    return b.enviar(async () => {
      const corpo = tf === 'uf' ? { tipo: tf, uf: f.uf } : tf === 'municipio' ? { tipo: tf, uf: f.uf, municipio: f.municipio.trim() }
        : tf === 'faixa_valor' ? { tipo: tf, ...(f.min ? { valorMin: f.min } : {}), ...(f.max ? { valorMax: f.max } : {}) } : { tipo: tf, texto: f.texto.trim() }
      await chamar('POST', `/empresas/${empresaId}/palavras-chave-filtros`, corpo)
      dados.recarregar()
    })
  }
  return (
    <div className="flex flex-col gap-6">
      <Aviso texto={dados.erro} />
      <Secao titulo="Termos">
        <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Orientam a relevância das oportunidades. Termos de exclusão só reduzem a nota; nunca escondem um edital.</p>
        {TIPOS.map((t) => {
          const itens = dados.dados?.termos.filter((x) => x.tipo === t.valor) ?? []
          if (!itens.length) return null
          return (
            <div key={t.valor} className="flex flex-col gap-4">
              <h3>{t.rotulo}</h3>
              <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
                {itens.map((x) => (
                  <div key={x.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left flex-wrap">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]"><strong><bdi>{x.termo}</bdi></strong></span>
                    {pode('arquivar') ? <Botao variante="texto" onClick={() => void chamar('POST', `/empresas/${empresaId}/palavras-chave/${x.id}/arquivar`).then(dados.recarregar)}>Remover</Botao> : null}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        {pode('cadastrar') ? (
          <form className="flex flex-col gap-4" onSubmit={(e) => void incluir(e)}>
            <Selecao rotulo="Tipo" value={tipo} onChange={setTipo} opcoes={TIPOS} />
            <Campo rotulo="Termo" value={termo} onChange={(v) => setTermo(v)} maxLength={120} />
            <Aviso texto={a.erro} />
            <Botao type="submit" variante="secundario" carregando={a.enviando}>Incluir termo</Botao>
          </form>
        ) : null}
      </Secao>
      <Secao titulo="Filtros">
        <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
          {dados.dados?.filtros.map((x) => (
            <div key={x.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left flex-wrap">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]"><strong>{TIPOS_FILTRO.find((t) => t.valor === x.tipo)?.rotulo}</strong><span className="legenda"><bdi>{rotuloFiltro(x)}</bdi></span></span>
              {pode('arquivar') ? <Botao variante="texto" onClick={() => void chamar('POST', `/empresas/${empresaId}/palavras-chave-filtros/${x.id}/arquivar`).then(dados.recarregar)}>Remover</Botao> : null}
            </div>
          ))}
        </div>
        {pode('cadastrar') ? (
          <form className="flex flex-col gap-4" onSubmit={(e) => void incluirFiltro(e)}>
            <Selecao rotulo="Tipo de filtro" value={tf} onChange={setTf} opcoes={TIPOS_FILTRO} />
            {tf === 'uf' || tf === 'municipio' ? <Selecao rotulo="UF" value={f.uf} onChange={(v) => setF({ ...f, uf: v })} opcoes={opcoesUf} /> : null}
            {tf === 'municipio' ? <Campo rotulo="Município" value={f.municipio} onChange={(v) => setF({ ...f, municipio: v })} maxLength={100} /> : null}
            {tf === 'faixa_valor' ? (<><Campo rotulo="Valor mínimo (R$)" inputMode="decimal" value={f.min} onChange={(v) => setF({ ...f, min: v.replace(',', '.') })} /><Campo rotulo="Valor máximo (R$)" inputMode="decimal" value={f.max} onChange={(v) => setF({ ...f, max: v.replace(',', '.') })} /></>) : null}
            {tf === 'restricao' ? <Campo rotulo="Restrição" value={f.texto} onChange={(v) => setF({ ...f, texto: v })} maxLength={300} /> : null}
            <Aviso texto={b.erro} />
            <Botao type="submit" variante="secundario" carregando={b.enviando}>Incluir filtro</Botao>
          </form>
        ) : null}
      </Secao>
    </div>
  )
}
