import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAcesso } from '../features/acesso/contexto'
import { useGet } from '../features/acesso/useGet'
import { Aviso, Botao, CabecalhoPagina, Campo, Cartao, Etiqueta, Legenda, Pagina, Selecao, Vazio } from '../ui'

interface Achado { tipo: string; id: string; titulo: string; subtitulo: string | null; data: string | null; situacao: string | null; link: string }
type Resultado = Record<string, Achado[] | null>
const GRUPOS: [string, string][] = [['edital', 'Editais'], ['resultado', 'Resultados'], ['contrato', 'Contratos'], ['peca', 'Peças jurídicas'], ['documento', 'Documentos'], ['produto', 'Produtos']]
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
const dia = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : null)

// Pesquisa histórica avançada (12.4): um texto e filtros combinados em editais, resultados, contratos, peças, documentos e produtos. Cada grupo só
// aparece se você pode ver o módulo; a busca por texto ignora acentos. A minuta e os valores ficam no módulo de origem.
export default function Busca() {
  const { empresa } = useAcesso()
  // A busca vive na URL (/busca?q=…&tipos=…): a busca rápida do topo, o botão voltar e links compartilhados levam direto ao resultado.
  const [params, setParams] = useSearchParams()
  const consulta = (params.get('q') ?? '').trim().length >= 2 ? params.toString() : null
  const [f, setF] = useState({ q: params.get('q') ?? '', tipo: params.get('tipos') ?? '', de: params.get('de') ?? '', ate: params.get('ate') ?? '', uf: params.get('uf') ?? '' })
  const [lido, setLido] = useState(params.get('q'))
  if (params.get('q') !== lido) {
    setLido(params.get('q'))
    setF({ q: params.get('q') ?? '', tipo: params.get('tipos') ?? '', de: params.get('de') ?? '', ate: params.get('ate') ?? '', uf: params.get('uf') ?? '' })
  }
  const empresaId = empresa?.empresaId ?? null
  const res = useGet<Resultado>(empresaId && consulta ? `/empresas/${empresaId}/busca?${consulta}` : null)
  if (!empresa || !empresaId) return <p className="py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  const buscar = () => {
    const p = new URLSearchParams({ q: f.q.trim() })
    if (f.tipo) p.set('tipos', f.tipo)
    if (f.de) p.set('de', f.de)
    if (f.ate) p.set('ate', f.ate)
    if (f.uf) p.set('uf', f.uf)
    setParams(p)
  }
  const dados = res.dados
  const vazio = dados !== undefined && GRUPOS.every(([k]) => !dados[k] || dados[k]?.length === 0)
  return (
    <Pagina larga>
      <CabecalhoPagina titulo="Busca" subtitulo={empresa.empresa} />
      <form className="grid grid-cols-1 gap-3 rounded-xl bg-secondary p-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); if (f.q.trim().length >= 2) buscar() }}>
        <div className="sm:col-span-2"><Campo rotulo="O que procurar (mín. 2 letras)" value={f.q} onChange={(v) => setF({ ...f, q: v })} maxLength={100} /></div>
        <Selecao rotulo="Onde" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} vazio="Tudo" opcoes={GRUPOS.map(([valor, rotulo]) => ({ valor, rotulo }))} />
        <Campo rotulo="De" type="date" value={f.de} onChange={(v) => setF({ ...f, de: v })} />
        <Campo rotulo="Até" type="date" value={f.ate} onChange={(v) => setF({ ...f, ate: v })} />
        <Selecao rotulo="UF do órgão (editais e resultados)" value={f.uf} onChange={(v) => setF({ ...f, uf: v })} vazio="Todas" opcoes={UFS.map((u) => ({ valor: u, rotulo: u }))} />
        <div className="flex items-end"><Botao type="submit" disabled={f.q.trim().length < 2} carregando={res.carregando}>Buscar</Botao></div>
      </form>
      <Legenda>As datas filtram: publicação (editais), validade (documentos), vigência final (contratos), ocorrência (resultados) e criação (peças e produtos). (EM DESENVOLVIMENTO)</Legenda>
      <Aviso texto={res.erro} />
      {consulta === null ? <Vazio>Digite um termo (órgão, objeto, número, marca, motivo…) e escolha os filtros.</Vazio> : null}
      {vazio ? <Vazio>Nada encontrado com esses filtros.</Vazio> : null}
      {dados ? GRUPOS.map(([k, rotulo]) => {
        const lista = dados[k]
        if (!lista || lista.length === 0) return null
        return (
          <Cartao key={k}><h2>{rotulo} <Etiqueta cor="cinza">{lista.length}{lista.length === 20 ? '+' : ''}</Etiqueta></h2>
            {lista.map((a) => (
              <Link key={a.id} to={a.link} className="flex flex-col gap-1 border-t border-secondary pt-2 no-underline">
                <span className="flex flex-wrap items-center gap-2"><strong className="text-primary [overflow-wrap:anywhere]"><bdi>{a.titulo}</bdi></strong>{a.situacao ? <Etiqueta cor="cinza">{a.situacao.replace(/_/g, ' ')}</Etiqueta> : null}</span>
                {a.subtitulo ? <span className="text-sm text-secondary [overflow-wrap:anywhere]"><bdi>{a.subtitulo}</bdi></span> : null}
                {a.data ? <Legenda>{dia(a.data)}</Legenda> : null}
              </Link>
            ))}
          </Cartao>
        )
      }) : null}
    </Pagina>
  )
}
