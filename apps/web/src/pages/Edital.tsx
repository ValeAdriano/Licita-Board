import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { chamar } from '../api/cliente'
import { useGet } from '../features/acesso/useGet'
import { useEnvio } from '../features/acesso/conta/useEnvio'
import { BannerFontes } from '../features/pesquisa/BannerFontes'
import { BENEFICIO, moeda, quando } from '../features/pesquisa/formato'
import { Aviso, Botao, Campo } from '../ui'

interface Item { id: string; numeroItem: number; descricao: string; quantidade: string | null; unidadeMedida: string | null; valorUnitario: string | null; valorTotal: string | null; beneficio: string; retirado: boolean }
interface Arquivo { id: string; tipo: string; titulo: string | null; urlOrigem: string; statusArquivo: string; motivo: string | null; tamanho: string | null; paginas: number | null; statusExtracao: string }
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
  if (e.erro) return <p className="vazio">Edital não encontrado ou sem permissão.</p>
  if (!e.dados) return <p className="legenda">Carregando…</p>
  const d = e.dados
  return (
    <div className="conteudo__miolo conteudo__miolo--largo entra">
      <Link to="/oportunidades">← Oportunidades</Link>
      <BannerFontes />
      <div>
        <h1><bdi>{d.orgao}</bdi></h1>
        <p className="legenda">{d.municipio ?? '—'}/{d.uf ?? '—'} · {d.modalidade ?? '—'} · nº {d.numeroEdital ?? '—'} · versão {d.versaoAtual}{d.origem === 'manual' ? ' · importado manualmente' : ''}</p>
        <p><bdi>{d.objeto}</bdi></p>
        <p className="legenda">
          Publicado em {quando(d.dataPublicacao)} · propostas até {quando(d.dataEncerramentoPropostas)} · valor estimado {moeda(d.valorEstimado)} · situação {d.situacao ?? '—'} · coletado em {quando(d.ultimaColetaEm)}
        </p>
        <p className="legenda">A data da sessão de disputa não vem da fonte e não é deduzida: confira no edital.</p>
        <div className="pilha" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {d.linkOrigem ? <a href={d.linkOrigem} target="_blank" rel="noreferrer noopener">Registro oficial no PNCP</a> : null}
          {d.linkPortal ? <a href={d.linkPortal} target="_blank" rel="noreferrer noopener">Portal de origem</a> : null}
        </div>
      </div>
      <Arquivos arquivos={d.arquivos} />
      <Busca editalId={d.id} />
      <h2>Itens ({d.itens.length})</h2>
      <div className="lista">
        {d.itens.map((i) => (
          <div key={i.id} className="lista__item" style={{ cursor: 'default', opacity: i.retirado ? 0.55 : 1 }}>
            <span className="lista__texto">
              <strong>Item {i.numeroItem}{i.retirado ? ' (retirado em retificação)' : ''}</strong>
              <span><bdi>{i.descricao}</bdi></span>
              <span className="legenda">{i.quantidade ?? '—'} {i.unidadeMedida ?? ''} · unitário {moeda(i.valorUnitario)} · total {moeda(i.valorTotal)}</span>
            </span>
            <span className="tag">{BENEFICIO[i.beneficio] ?? i.beneficio}</span>
          </div>
        ))}
      </div>
      <h2>Versões</h2>
      <div className="lista">
        {d.versoes.map((v) => (
          <div key={v.versao} className="lista__item" style={{ cursor: 'default' }}>
            <span className="lista__texto">
              <strong>Versão {v.versao}</strong>
              <span className="legenda">{quando(v.coletadaEm)}{v.camposAlterados.length ? ` · mudou: ${v.camposAlterados.map((c) => CAMPO[c] ?? c).join(', ')}` : ' · primeira coleta'}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Arquivos({ arquivos }: { arquivos: Arquivo[] }) {
  const { erro, enviar } = useEnvio()
  const baixar = (a: Arquivo) =>
    enviar(async () => {
      const r = await chamar<{ url: string }>('POST', `/editais/arquivos/${a.id}/download`)
      window.location.assign(r.url)
    })
  return (
    <div className="pilha">
      <h2>Arquivos originais ({arquivos.length})</h2>
      <Aviso texto={erro} />
      <div className="lista">
        {arquivos.map((a) => (
          <div key={a.id} className="lista__item lista__item--acoes" style={{ cursor: 'default' }}>
            <span className="lista__texto">
              <strong><bdi>{a.titulo ?? a.tipo}</bdi></strong>
              <span className="legenda">
                {ARQUIVO[a.statusArquivo] ?? a.statusArquivo}{a.motivo ? ` (${a.motivo})` : ''} · texto: {a.statusExtracao}{a.paginas ? ` · ${a.paginas} páginas` : ''}
              </span>
            </span>
            {a.statusArquivo === 'liberado' ? <Botao variante="secundario" onClick={() => void baixar(a)}>Baixar</Botao> : null}
          </div>
        ))}
      </div>
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
    <form className="pilha" onSubmit={(ev) => void buscar(ev)}>
      <h2>Buscar no texto dos arquivos</h2>
      <Campo rotulo="Palavra ou expressão" value={q} onChange={(ev) => setQ(ev.target.value)} maxLength={120} />
      <Aviso texto={erro} />
      <Botao type="submit" variante="secundario" carregando={enviando} disabled={q.trim().length < 2}>Buscar</Botao>
      {achados?.length === 0 ? <p className="vazio">Nada encontrado nos arquivos já processados.</p> : null}
      {achados?.map((t) => (
        <p key={t.id} className="legenda">
          <strong><bdi>{t.arquivoTitulo ?? 'arquivo'}</bdi> · p. {t.pagina}{t.origemExtracao === 'ocr' ? ' · lido por OCR' : ''}</strong>
          <br />
          <bdi>{t.texto}</bdi>
        </p>
      ))}
    </form>
  )
}
