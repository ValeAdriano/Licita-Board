import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { chamar } from '../../api/cliente'
import { Abas, Aviso, Botao, Campo, Etiqueta } from '../../ui'
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
    <div className="flex flex-col gap-6">
      <BannerFontes />
      <Abas
        rotulo="Relevância"
        ativa={aba}
        aoMudar={trocar}
        abas={ABAS.map((a) => ({ id: a.id, rotulo: `${a.rotulo} (${a.id === 'todas' ? total : (contagem[a.id] ?? 0)})` }))}
      />
      <Caixa rotulo="Incluir editais com prazo de propostas já encerrado" marcado={encerradas} onChange={(v) => { setEncerradas(v); setPagina(1) }} />
      <Aviso texto={lista.erro} />
      {lista.carregando ? <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Carregando…</p> : null}
      {lista.dados && lista.dados.itens.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-tertiary">
          Nenhuma oportunidade nesta aba. {total === 0 ? 'Cadastre palavras-chave em Cadastros e aguarde a próxima busca, ou importe um edital.' : 'Veja as outras abas.'}
        </p>
      ) : null}
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {lista.dados?.itens.map((o) => <Cartao key={o.id} o={o} empresaId={empresaId} podeTriar={pode('editar')} aoMudar={lista.recarregar} />)}
      </div>
      {lista.dados && (pagina > 1 || lista.dados.itens.length === lista.dados.porPagina) ? (
        <div className="flex gap-4 flex-row items-center">
          <Botao variante="secundario" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>Anterior</Botao>
          <span className="text-sm text-tertiary [overflow-wrap:anywhere]">Página {pagina}</span>
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
    <article className="flex min-h-14 w-full items-center px-4 py-3 text-left flex-col items-stretch gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
        <strong><bdi>{o.orgao}</bdi> · {o.municipio ?? '—'}/{o.uf ?? '—'}</strong>
        <span><bdi>{o.descricao}</bdi></span>
        <span className="text-sm text-tertiary [overflow-wrap:anywhere]">
          Item {o.numeroItem} · {o.quantidade ?? '—'} {o.unidadeMedida ?? ''} · {moeda(o.valorTotal)} · {o.modalidade ?? '—'} · propostas até {quando(o.encerramentoPropostas)}
        </span>
        <span className="text-sm text-tertiary [overflow-wrap:anywhere]"><bdi>{o.objeto}</bdi></span>
      </div>
      <div className="flex flex-row items-center flex-wrap gap-1">
        <Etiqueta cor={o.faixa === 'baixa' ? 'cinza' : 'aviso'}>{FAIXA[o.faixa]} · {o.nota}</Etiqueta>
        <Etiqueta>{BENEFICIO[o.beneficio] ?? o.beneficio}</Etiqueta>
        {o.triagem !== 'nova' ? <Etiqueta>{o.triagem === 'descartada_pelo_usuario' ? 'Descartada' : o.triagem === 'interesse' ? 'Interesse' : 'Vista'}</Etiqueta> : null}
        {o.foraDosFiltros.length > 0 ? <Etiqueta>Fora dos seus filtros</Etiqueta> : null}
      </div>
      {o.motivos.length > 0 ? (
        <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Achou: {o.motivos.map((m) => `“${m.termo ?? m.tipo}” ${ONDE[m.onde ?? ''] ?? ''}${m.pagina ? ` (p. ${m.pagina})` : ''}`).join('; ')}</p>
      ) : null}
      <div className="flex gap-4 flex-row items-center flex-wrap">
        <Link to={`/editais/${o.editalId}`}>Abrir edital</Link>
        {o.linkOrigem ? <a href={o.linkOrigem} target="_blank" rel="noreferrer noopener">Fonte oficial</a> : null}
      </div>
      {podeTriar && !descartando ? (
        <div className="flex gap-4 flex-row items-center flex-wrap">
          <Botao variante="secundario" carregando={enviando} onClick={() => void triar('interesse')}>Tenho interesse</Botao>
          <Botao variante="secundario" onClick={() => void triar('vista')}>Marcar como vista</Botao>
          <Botao variante="texto" onClick={() => setDescartando(true)}>Descartar…</Botao>
        </div>
      ) : null}
      {descartando ? (
        <div className="flex flex-col gap-4">
          <Campo rotulo="Motivo do descarte (fica registrado)" value={motivo} onChange={(v) => setMotivo(v)} maxLength={500} />
          <div className="flex gap-4 flex-row items-center">
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
    <div className="flex flex-col gap-6">
      <form className="flex flex-col gap-4" onSubmit={(e) => void pesquisar(e)}>
        <h2>Pesquisar agora</h2>
        <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Busca no PNCP por data de publicação (até 31 dias). A busca automática roda às 07h, 12h e 17h.</p>
        <Campo rotulo="De" type="date" value={f.inicio} onChange={(v) => setF({ ...f, inicio: v })} />
        <Campo rotulo="Até" type="date" value={f.fim} onChange={(v) => setF({ ...f, fim: v })} />
        <Campo rotulo="UF" value={f.uf} onChange={(v) => setF({ ...f, uf: v.toUpperCase().slice(0, 2) })} maxLength={2} />
        <Aviso texto={pesquisa.erro} />
        <Aviso tipo="info" texto={pesquisa.ok} />
        <Botao type="submit" carregando={pesquisa.enviando} disabled={!f.inicio || !f.fim || f.uf.length !== 2}>Pesquisar</Botao>
      </form>
      <form className="flex flex-col gap-4" onSubmit={(e) => void importar(e)}>
        <h2>Importar edital</h2>
        <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Cole o link do edital no PNCP (https://pncp.gov.br/app/editais/…). Upload de arquivo: EM DESENVOLVIMENTO.</p>
        <Campo rotulo="Link do PNCP" value={f.url} onChange={(v) => setF({ ...f, url: v })} maxLength={1000} />
        <Aviso texto={importacao.erro} />
        <Aviso tipo="info" texto={importacao.ok} />
        <Botao type="submit" carregando={importacao.enviando} disabled={!f.url.trim()}>Importar</Botao>
      </form>
      <h3>Importações recentes</h3>
      {importacoes.dados?.length === 0 ? <p className="px-4 py-10 text-center text-sm text-tertiary">Nenhuma importação.</p> : null}
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {importacoes.dados?.map((i) => (
          <div key={i.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
              <strong><bdi>{i.url}</bdi></strong>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">{i.status === 'ok' ? 'Importado' : i.status === 'falhou' ? `Falhou: ${i.erro ?? ''}` : 'Em andamento'}</span>
            </span>
            {i.editalId ? <Link to={`/editais/${i.editalId}`}>Abrir</Link> : null}
          </div>
        ))}
      </div>
    </div>
  )
}
