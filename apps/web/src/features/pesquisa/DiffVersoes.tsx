import { Aviso, Etiqueta } from '../../ui'
import { useGet } from '../acesso/useGet'
import { moeda, quando } from './formato'

interface Mudanca { campo: string; rotulo: string; formato: 'texto' | 'data' | 'dinheiro' | 'booleano'; antes: string | null; depois: string | null }
interface DiffItem { numeroItem: number; descricao: string; tipo: 'adicionado' | 'removido' | 'alterado'; mudancas: Mudanca[] }
interface DiffArquivo { titulo: string | null; tipo: string; url: string; situacao: 'novo' | 'removido' }
interface Diff { de: number; para: number; campos: Mudanca[]; itens: DiffItem[]; arquivos: DiffArquivo[]; alteraProposta: boolean }

const ROTULO_ITEM = { adicionado: 'Item novo', removido: 'Item retirado', alterado: 'Item alterado' } as const
const valor = (m: Mudanca, v: string | null): string => {
  if (v === null) return '—'
  if (m.formato === 'data') return quando(v)
  if (m.formato === 'dinheiro') return moeda(v)
  if (m.formato === 'booleano') return v === 'true' ? 'Sim' : 'Não'
  return v
}

// O que mudou entre duas versões coletadas do edital. Só fatos: a conclusão (reabrir prazo, impugnar) é sempre humana.
// Texto de edital é DADO e aparece sempre como texto.
export function DiffVersoes({ editalId, de, para }: { editalId: string; de: number; para: number }) {
  const r = useGet<Diff>(`/editais/${editalId}/comparar?de=${de}&para=${para}`)
  if (r.carregando) return <p className="text-sm text-tertiary">Comparando as versões…</p>
  if (r.erro || !r.dados) return <Aviso texto={r.erro ?? 'Não foi possível comparar estas versões.'} />
  const d = r.dados
  const vazio = d.campos.length === 0 && d.itens.length === 0 && d.arquivos.length === 0
  return (
    <section aria-label={`Mudanças da versão ${d.de} para a ${d.para}`} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-secondary">Mudanças da versão {d.de} para a {d.para}</h3>
      {d.alteraProposta ? <Aviso tipo="atencao" texto="Esta retificação altera o conteúdo da proposta (objeto, itens ou quantidades): avalie a necessidade de reabrir o prazo de publicação. A decisão é sua; o sistema não conclui. (Texto provisório, aguardando validação do jurídico.)" /> : null}
      {vazio ? <p className="text-sm text-tertiary">Nenhuma diferença nos campos acompanhados (a mudança pode ter sido só de formato na fonte).</p> : null}
      {d.campos.map((m) => <Linha key={m.campo} titulo={m.rotulo} m={m} />)}
      {d.itens.map((i) => (
        <div key={i.numeroItem} className="flex flex-col gap-2 rounded-xl bg-primary p-3 ring-1 ring-secondary">
          <div className="flex flex-wrap items-center gap-2"><Etiqueta cor={i.tipo === 'alterado' ? 'aviso' : i.tipo === 'adicionado' ? 'sucesso' : 'erro'}>{ROTULO_ITEM[i.tipo]}</Etiqueta><strong>Item {i.numeroItem}</strong></div>
          <p className="text-sm text-secondary [overflow-wrap:anywhere]"><bdi>{i.descricao.slice(0, 200)}</bdi></p>
          {i.mudancas.map((m) => <Linha key={m.campo} titulo={m.rotulo} m={m} />)}
        </div>
      ))}
      {d.arquivos.map((a) => (
        <div key={a.url + a.situacao} className="flex flex-wrap items-center gap-2 rounded-xl bg-primary p-3 ring-1 ring-secondary">
          <Etiqueta cor={a.situacao === 'novo' ? 'sucesso' : 'erro'}>{a.situacao === 'novo' ? 'Arquivo novo' : 'Arquivo retirado'}</Etiqueta>
          <span className="min-w-0 text-sm [overflow-wrap:anywhere]"><bdi>{a.titulo ?? a.url}</bdi></span>
        </div>
      ))}
    </section>
  )
}

function Linha({ titulo, m }: { titulo: string; m: Mudanca }) {
  return (
    <div className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[10rem_1fr_1fr] sm:gap-3">
      <span className="font-medium text-secondary">{titulo}</span>
      <span className="[overflow-wrap:anywhere] text-error-primary"><span className="sr-only">Antes: </span><bdi>{valor(m, m.antes)}</bdi></span>
      <span className="[overflow-wrap:anywhere] text-success-primary"><span className="sr-only">Depois: </span><bdi>{valor(m, m.depois)}</bdi></span>
    </div>
  )
}
