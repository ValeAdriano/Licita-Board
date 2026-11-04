import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { chamar } from '../../api/cliente'
import { Aviso, Botao, Campo } from '../../ui'
import { Caixa } from '../acesso/cadastros/comum'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useGet } from '../acesso/useGet'
import { BannerFontes } from './BannerFontes'
import { BENEFICIO, FAIXA, moeda, quando } from './formato'

interface Motivo { tipo: string; termo?: string; onde?: string; pagina?: number }
interface Op {
  id: string; nota: number; faixa: string; motivos: Motivo[]; foraDosFiltros: { filtro: string }[]; triagem: string
  numeroItem: number; descricao: string; quantidade: string | null; unidadeMedida: string | null; valorTotal: string | null; beneficio: string
  editalId: string; objeto: string; modalidade: string | null; numeroEdital: string | null; encerramentoPropostas: string | null
  linkOrigem: string | null; orgao: string; uf: string | null; municipio: string | null
}
interface Lista { itens: Op[]; contagem: Record<string, number>; pagina: number; porPagina: number }

type Aba = 'alta' | 'media' | 'baixa' | 'todas'
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'alta', rotulo: 'Alta' }, { id: 'media', rotulo: 'Média' }, { id: 'baixa', rotulo: 'Baixa relevância' }, { id: 'todas', rotulo: 'Todas' },
]
const ONDE: Record<string, string> = { item: 'no item', objeto: 'no objeto', trecho: 'nos anexos' }

// Oportunidades da empresa (Fase 04): cada item de edital avaliado contra as palavras-chave. Baixa relevância
// fica visível e nunca é apagada; descartar exige motivo e continua registrado.
export function Oportunidades({ empresaId, pode }: { empresaId: string; pode: (acao: string) => boolean }) {
  const [aba, setAba] = useState<Aba>('todas')
  const [escolheu, setEscolheu] = useState(false)
  const [encerradas, setEncerradas] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [contagem, setContagem] = useState<Record<string, number>>({})
  const filtro = aba === 'todas' ? '' : `&faixa=${aba}`
  const lista = useGet<Lista>(`/empresas/${empresaId}/oportunidades?pagina=${pagina}&encerradas=${encerradas ? 1 : 0}${filtro}`)
  const novaContagem = lista.dados?.contagem
  // Contagens ficam na tela enquanto a lista recarrega; sem escolha da pessoa, abre na melhor faixa com itens.
  // (estado derivado ajustado durante a renderização, como a documentação do React recomenda)
  if (novaContagem && novaContagem !== contagem) {
    setContagem(novaContagem)
    if (!escolheu) {
      const melhor = (['alta', 'media', 'baixa'] as const).find((f) => (novaContagem[f] ?? 0) > 0)
      if (melhor && melhor !== aba) setAba(melhor)
    }
  }
  const total = (contagem.alta ?? 0) + (contagem.media ?? 0) + (contagem.baixa ?? 0)
  const trocar = (a: Aba) => { setEscolheu(true); setAba(a); setPagina(1) }
  return (
    <div className="pilha pilha--grande">
      <BannerFontes />
      <div role="tablist" aria-label="Relevância" className="pilha" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {ABAS.map((a) => (
          <Botao key={a.id} role="tab" aria-selected={aba === a.id} variante={aba === a.id ? 'primario' : 'secundario'} onClick={() => trocar(a.id)}>
            {a.rotulo} ({a.id === 'todas' ? total : (contagem[a.id] ?? 0)})
          </Botao>
        ))}
      </div>
      <Caixa rotulo="Incluir editais com prazo de propostas já encerrado" marcado={encerradas} onChange={(v) => { setEncerradas(v); setPagina(1) }} />
      <Aviso texto={lista.erro} />
      {lista.carregando ? <p className="legenda">Carregando…</p> : null}
      {lista.dados && lista.dados.itens.length === 0 ? (
        <p className="vazio">
          Nenhuma oportunidade nesta aba. {total === 0 ? 'Cadastre palavras-chave em Cadastros e aguarde a próxima busca, ou importe um edital.' : 'Veja as outras abas.'}
        </p>
      ) : null}
      <div className="lista">
        {lista.dados?.itens.map((o) => <Cartao key={o.id} o={o} empresaId={empresaId} podeTriar={pode('editar')} aoMudar={lista.recarregar} />)}
      </div>
      {lista.dados && (pagina > 1 || lista.dados.itens.length === lista.dados.porPagina) ? (
        <div className="pilha" style={{ flexDirection: 'row' }}>
          <Botao variante="secundario" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>Anterior</Botao>
          <span className="legenda">Página {pagina}</span>
          <Botao variante="secundario" disabled={lista.dados.itens.length < lista.dados.porPagina} onClick={() => setPagina(pagina + 1)}>Próxima</Botao>
        </div>
      ) : null}
    </div>
  )
}

function Cartao({ o, empresaId, podeTriar, aoMudar }: { o: Op; empresaId: string; podeTriar: boolean; aoMudar: () => void }) {
  const [descartando, setDescartando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const { enviando, erro, enviar } = useEnvio()
  const triar = (triagem: string, m?: string) =>
    enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/oportunidades/${o.id}/triagem`, { triagem, motivo: m ?? null })
      setDescartando(false)
      aoMudar()
    })
  return (
    <article className="lista__item" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: 'var(--e2)' }}>
      <div className="lista__texto">
        <strong><bdi>{o.orgao}</bdi> · {o.municipio ?? '—'}/{o.uf ?? '—'}</strong>
        <span><bdi>{o.descricao}</bdi></span>
        <span className="legenda">
          Item {o.numeroItem} · {o.quantidade ?? '—'} {o.unidadeMedida ?? ''} · {moeda(o.valorTotal)} · {o.modalidade ?? '—'} · propostas até {quando(o.encerramentoPropostas)}
        </span>
        <span className="legenda"><bdi>{o.objeto}</bdi></span>
      </div>
      <div className="pilha" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 'var(--e1)' }}>
        <span className={o.faixa === 'baixa' ? 'tag' : 'tag tag--aviso'}>{FAIXA[o.faixa]} · {o.nota}</span>
        <span className="tag">{BENEFICIO[o.beneficio] ?? o.beneficio}</span>
        {o.triagem !== 'nova' ? <span className="tag">{o.triagem === 'descartada_pelo_usuario' ? 'Descartada' : o.triagem === 'interesse' ? 'Interesse' : 'Vista'}</span> : null}
        {o.foraDosFiltros.length > 0 ? <span className="tag">Fora dos seus filtros</span> : null}
      </div>
      {o.motivos.length > 0 ? (
        <p className="legenda">Achou: {o.motivos.map((m) => `“${m.termo ?? m.tipo}” ${ONDE[m.onde ?? ''] ?? ''}${m.pagina ? ` (p. ${m.pagina})` : ''}`).join('; ')}</p>
      ) : null}
      <div className="pilha" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Link to={`/editais/${o.editalId}`}>Abrir edital</Link>
        {o.linkOrigem ? <a href={o.linkOrigem} target="_blank" rel="noreferrer noopener">Fonte oficial</a> : null}
      </div>
      {podeTriar && !descartando ? (
        <div className="pilha" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Botao variante="secundario" carregando={enviando} onClick={() => void triar('interesse')}>Tenho interesse</Botao>
          <Botao variante="secundario" onClick={() => void triar('vista')}>Marcar como vista</Botao>
          <Botao variante="texto" onClick={() => setDescartando(true)}>Descartar…</Botao>
        </div>
      ) : null}
      {descartando ? (
        <div className="pilha">
          <Campo rotulo="Motivo do descarte (fica registrado)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} />
          <div className="pilha" style={{ flexDirection: 'row' }}>
            <Botao variante="perigo" disabled={motivo.trim().length < 3} carregando={enviando} onClick={() => void triar('descartada_pelo_usuario', motivo.trim())}>Descartar</Botao>
            <Botao variante="texto" onClick={() => setDescartando(false)}>Cancelar</Botao>
          </div>
        </div>
      ) : null}
      <Aviso texto={erro} />
    </article>
  )
}

// Busca manual: pesquisa sob demanda numa janela de datas e importação de um edital pelo link do PNCP.
export function BuscarEdital({ empresaId }: { empresaId: string }) {
  const [f, setF] = useState({ inicio: '', fim: '', uf: 'PR', url: '' })
  const pesquisa = useEnvio()
  const importacao = useEnvio()
  const importacoes = useGet<{ id: string; url: string | null; status: string; erro: string | null; editalId: string | null }[]>(`/empresas/${empresaId}/importacoes`)
  const pesquisar = (e: FormEvent) => {
    e.preventDefault()
    return pesquisa.enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/pesquisas`, { fonte: 'pncp', inicio: f.inicio, fim: f.fim, uf: f.uf })
      return 'Pesquisa enfileirada. Os resultados aparecem em Oportunidades em alguns minutos.'
    })
  }
  const importar = (e: FormEvent) => {
    e.preventDefault()
    return importacao.enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/importacoes`, { url: f.url.trim() })
      setF({ ...f, url: '' })
      importacoes.recarregar()
      return 'Importação enfileirada.'
    })
  }
  return (
    <div className="pilha pilha--grande">
      <form className="pilha" onSubmit={(e) => void pesquisar(e)}>
        <h2>Pesquisar agora</h2>
        <p className="legenda">Busca no PNCP por data de publicação (até 31 dias). A busca automática roda às 07h, 12h e 17h.</p>
        <Campo rotulo="De" type="date" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
        <Campo rotulo="Até" type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} />
        <Campo rotulo="UF" value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} />
        <Aviso texto={pesquisa.erro} />
        <Aviso tipo="info" texto={pesquisa.ok} />
        <Botao type="submit" carregando={pesquisa.enviando} disabled={!f.inicio || !f.fim || f.uf.length !== 2}>Pesquisar</Botao>
      </form>
      <form className="pilha" onSubmit={(e) => void importar(e)}>
        <h2>Importar edital</h2>
        <p className="legenda">Cole o link do edital no PNCP (https://pncp.gov.br/app/editais/…). Upload de arquivo: EM DESENVOLVIMENTO.</p>
        <Campo rotulo="Link do PNCP" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} maxLength={1000} />
        <Aviso texto={importacao.erro} />
        <Aviso tipo="info" texto={importacao.ok} />
        <Botao type="submit" carregando={importacao.enviando} disabled={!f.url.trim()}>Importar</Botao>
      </form>
      <h3>Importações recentes</h3>
      {importacoes.dados?.length === 0 ? <p className="vazio">Nenhuma importação.</p> : null}
      <div className="lista">
        {importacoes.dados?.map((i) => (
          <div key={i.id} className="lista__item" style={{ cursor: 'default' }}>
            <span className="lista__texto">
              <strong><bdi>{i.url}</bdi></strong>
              <span className="legenda">{i.status === 'ok' ? 'Importado' : i.status === 'falhou' ? `Falhou: ${i.erro ?? ''}` : 'Em andamento'}</span>
            </span>
            {i.editalId ? <Link to={`/editais/${i.editalId}`}>Abrir</Link> : null}
          </div>
        ))}
      </div>
    </div>
  )
}
