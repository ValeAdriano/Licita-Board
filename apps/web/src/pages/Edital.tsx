import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { chamar } from '../api/cliente'
import { useAcesso } from '../features/acesso/contexto'
import { useGet } from '../features/acesso/useGet'
import { useEnvio } from '../features/acesso/conta/useEnvio'
import { BannerFontes } from '../features/pesquisa/BannerFontes'
import { DiffVersoes } from '../features/pesquisa/DiffVersoes'
import { BENEFICIO, moeda, quando } from '../features/pesquisa/formato'
import { Aviso, Botao, CabecalhoPagina, Campo, Cartao, Etiqueta, Legenda, Pagina } from '../ui'

interface Item { id: string; numeroItem: number; descricao: string; quantidade: string | null; unidadeMedida: string | null; valorUnitario: string | null; valorTotal: string | null; beneficio: string; retirado: boolean }
interface Arquivo { id: string; tipo: string; titulo: string | null; urlOrigem: string; statusArquivo: string; motivo: string | null; tamanho: string | null; paginas: number | null; statusExtracao: string; arquivoPaiId: string | null; statusCompactado: 'extraido' | 'pendente' | 'recusado' | null; motivoCompactado: string | null }
interface Versao { versao: number; coletadaEm: string; camposAlterados: string[] }
interface Edital {
  id: string; idExterno: string; numeroEdital: string | null; modalidade: string | null; objeto: string; valorEstimado: string | null; situacao: string | null
  dataPublicacao: string | null; dataEncerramentoPropostas: string | null; linkOrigem: string | null; linkPortal: string | null; versaoAtual: number; origem: string
  ultimaColetaEm: string | null; orgao: string; uf: string | null; municipio: string | null; itens: Item[]; arquivos: Arquivo[]; versoes: Versao[]
}
interface Trecho { id: string; arquivoTitulo: string | null; pagina: number; origemExtracao: string; texto: string }

const ARQUIVO: Record<string, string> = { pendente: 'Na fila', quarentena: 'Em verificação', liberado: 'Liberado', bloqueado: 'Bloqueado', grande_demais: 'Grande demais', falhou: 'Falhou' }
const CAMPO: Record<string, string> = { itens: 'itens', arquivos: 'arquivos', objeto: 'objeto', situacao: 'situação', data_encerramento_propostas: 'fim do prazo de propostas', data_abertura_propostas: 'abertura de propostas', valor_estimado: 'valor estimado' }

// Edital público (Fase 04): dados do órgão, itens individualizados, arquivos originais com hash e origem,
// versões (retificações) e busca no texto extraído. Texto de edital é DADO: sempre exibido como texto.
export default function PaginaEdital() {
  const { id } = useParams()
  const e = useGet<Edital>(id ? `/editais/${id}` : null)
  const { empresa, pode } = useAcesso()
  const navegar = useNavigate()
  const acomp = useEnvio()
  const [comparando, setComparando] = useState<number | null>(null)
  if (e.erro) return <p className="px-4 py-10 text-center text-sm text-tertiary">Edital não encontrado ou sem permissão.</p>
  if (!e.dados) return <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Carregando…</p>
  const d = e.dados
  return (
    <Pagina larga>
      <Link to="/oportunidades">← Oportunidades</Link>
      <BannerFontes />
      <CabecalhoPagina
        titulo={d.orgao}
        subtitulo={`${d.municipio ?? '—'}/${d.uf ?? '—'} · ${d.modalidade ?? '—'} · nº ${d.numeroEdital ?? '—'} · versão ${d.versaoAtual}${d.origem === 'manual' ? ' · importado manualmente' : ''}`}
        acoes={
          <>
            {empresa && pode('agenda', 'cadastrar') ? (
              <Botao carregando={acomp.enviando} onClick={() => void acomp.enviar(async () => { const r = await chamar<{ id: string }>('POST', `/empresas/${empresa.empresaId}/acompanhamentos`, { editalId: d.id }); void navegar(`/agenda/acompanhamentos/${r.id}`) })}>Acompanhar na agenda</Botao>
            ) : null}
            {d.linkOrigem ? <Botao variante="secundario" onClick={() => window.open(d.linkOrigem ?? '', '_blank', 'noopener,noreferrer')}>Registro oficial no PNCP</Botao> : null}
            {d.linkPortal ? <Botao variante="secundario" onClick={() => window.open(d.linkPortal ?? '', '_blank', 'noopener,noreferrer')}>Portal de origem</Botao> : null}
          </>
        }
      />
      <Aviso texto={acomp.erro} />
      <Cartao>
        <p><bdi>{d.objeto}</bdi></p>
        <Legenda>
          Publicado em {quando(d.dataPublicacao)} · propostas até {quando(d.dataEncerramentoPropostas)} · valor estimado {moeda(d.valorEstimado)} · situação {d.situacao ?? '—'} · coletado em {quando(d.ultimaColetaEm)}
        </Legenda>
        <Legenda>A data da sessão de disputa não vem da fonte e não é deduzida: confira no edital.</Legenda>
      </Cartao>
      <Arquivos arquivos={d.arquivos} />
      <Busca editalId={d.id} />
      <h2>Itens ({d.itens.length})</h2>
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {d.itens.map((i) => (
          <div key={i.id} className={`flex min-h-14 w-full flex-wrap items-center gap-3 px-4 py-3 text-left ${i.retirado ? 'opacity-55' : ''}`}>
            <span className="flex min-w-48 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
              <strong>Item {i.numeroItem}{i.retirado ? ' (retirado em retificação)' : ''}</strong>
              <span><bdi>{i.descricao}</bdi></span>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">{i.quantidade ?? '—'} {i.unidadeMedida ?? ''} · unitário {moeda(i.valorUnitario)} · total {moeda(i.valorTotal)}</span>
            </span>
            <Etiqueta>{BENEFICIO[i.beneficio] ?? i.beneficio}</Etiqueta>
          </div>
        ))}
      </div>
      <h2>Versões</h2>
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {d.versoes.map((v) => (
          <div key={v.versao} className="flex flex-col gap-3 px-4 py-3">
            <div className="flex min-h-10 w-full flex-wrap items-center gap-3 text-left">
              <span className="flex min-w-48 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
                <strong>Versão {v.versao}</strong>
                <span className="text-sm text-tertiary [overflow-wrap:anywhere]">{quando(v.coletadaEm)}{v.camposAlterados.length ? ` · mudou: ${v.camposAlterados.map((c) => CAMPO[c] ?? c).join(', ')}` : ' · primeira coleta'}</span>
              </span>
              {v.versao > 1 ? <Botao variante="secundario" onClick={() => setComparando(comparando === v.versao ? null : v.versao)}>{comparando === v.versao ? 'Ocultar mudanças' : 'Ver o que mudou'}</Botao> : null}
            </div>
            {comparando === v.versao ? <DiffVersoes editalId={d.id} de={v.versao - 1} para={v.versao} /> : null}
          </div>
        ))}
      </div>
    </Pagina>
  )
}

function Arquivos({ arquivos }: { arquivos: Arquivo[] }) {
  const { erro, enviar } = useEnvio()
  const baixar = (a: Arquivo) =>
    enviar(async () => {
      const r = await chamar<{ url: string }>('POST', `/editais/arquivos/${a.id}/download`)
      window.location.assign(r.url)
    })
  const porId = new Map(arquivos.map((a) => [a.id, a]))
  const principais = arquivos.filter((a) => !a.arquivoPaiId || !porId.has(a.arquivoPaiId))
  const cartao = (a: Arquivo) => (
    <div className="flex min-h-14 w-full flex-wrap items-center gap-3 px-4 py-3 text-left">
      <div className="flex min-w-0 flex-1 flex-col gap-1 [overflow-wrap:anywhere]">
        <strong><bdi>{a.titulo ?? a.tipo}</bdi></strong>
        {a.arquivoPaiId ? <span className="text-sm text-tertiary">Dentro de <bdi>{porId.get(a.arquivoPaiId)?.titulo ?? 'compactado de origem'}</bdi></span> : null}
        {a.statusCompactado ? (
          <div className="flex flex-wrap gap-1">
            <Etiqueta cor={a.statusCompactado === 'extraido' ? 'sucesso' : 'aviso'}>
              Compactado: {a.statusCompactado === 'extraido' ? 'extraído' : a.statusCompactado}
            </Etiqueta>
          </div>
        ) : null}
        {a.motivoCompactado ? <p className={a.statusCompactado === 'extraido' ? 'text-sm text-tertiary' : 'text-sm font-medium text-warning-primary'}>{a.motivoCompactado}</p> : null}
        <span className="text-sm text-tertiary [overflow-wrap:anywhere]">
          {ARQUIVO[a.statusArquivo] ?? a.statusArquivo}{a.motivo ? ` (${a.motivo})` : ''} · texto: {a.statusExtracao}{a.paginas ? ` · ${a.paginas} páginas` : ''}
        </span>
      </div>
      {a.statusArquivo === 'liberado' ? <Botao variante="secundario" onClick={() => void baixar(a)}>Baixar</Botao> : null}
    </div>
  )
  return (
    <div className="flex flex-col gap-4">
      <h2>Arquivos originais ({arquivos.length})</h2>
      <Aviso texto={erro} />
      <ul aria-label="Arquivos do edital" className="flex min-w-0 flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {principais.map((a) => {
          const filhos = arquivos.filter((filho) => filho.arquivoPaiId === a.id)
          return (
            <li key={a.id} className="min-w-0">
              {cartao(a)}
              {filhos.length ? (
                <ul aria-label={`Arquivos dentro de ${a.titulo ?? a.tipo}`} className="ml-3 min-w-0 border-l border-secondary sm:ml-6">
                  {filhos.map((filho) => <li key={filho.id}>{cartao(filho)}</li>)}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Busca({ editalId }: { editalId: string }) {
  const [q, setQ] = useState('')
  const [achados, setAchados] = useState<Trecho[] | null>(null)
  const { enviando, erro, enviar } = useEnvio()
  const buscar = (ev: FormEvent) => {
    ev.preventDefault()
    return enviar(async () => setAchados(await chamar<Trecho[]>('GET', `/editais/${editalId}/trechos?q=${encodeURIComponent(q.trim())}`)))
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(ev) => void buscar(ev)}>
      <h2>Buscar no texto dos arquivos</h2>
      <Campo rotulo="Palavra ou expressão" value={q} onChange={(v) => setQ(v)} maxLength={120} />
      <Aviso texto={erro} />
      <Botao type="submit" variante="secundario" carregando={enviando} disabled={q.trim().length < 2}>Buscar</Botao>
      {achados?.length === 0 ? <p className="px-4 py-10 text-center text-sm text-tertiary">Nada encontrado nos arquivos já processados.</p> : null}
      {achados?.map((t) => (
        <p key={t.id} className="text-sm text-tertiary [overflow-wrap:anywhere]">
          <strong><bdi>{t.arquivoTitulo ?? 'arquivo'}</bdi> · p. {t.pagina}{t.origemExtracao === 'ocr' ? ' · lido por OCR' : ''}</strong>
          <br />
          <bdi>{t.texto}</bdi>
        </p>
      ))}
    </form>
  )
}
