import { Link } from 'react-router'
import { Aviso, Etiqueta, Legenda, Vazio } from '../../ui'
import { useGet } from '../acesso/useGet'
import { dataHoraSP } from '../agenda/comum'

interface Linha { participacaoId: string; resultado: string; vencedoraNome: string | null; ocorridoEm: string; numeroItem: number | null; item: string | null; numeroEdital: string | null; orgao: string | null; parecerId: string | null; recomendacao: string | null; bloqueado: boolean | null; analiseStatus: string | null; pecaId: string | null; achados: number | null }
export const RECOMENDACAO: Record<string, string> = { recorrer: 'Recorrer', nao_recorrer: 'Não recorrer', apenas_registrar: 'Apenas registrar' }

// Itens em que a empresa não foi a primeira colocada (gatilho recursal do resultado): abre-se o parecer de viabilidade recursal (10.4).
export function Pareceres({ empresaId }: { empresaId: string }) {
  const lista = useGet<Linha[]>(`/empresas/${empresaId}/juridico/pareceres`)
  return (
    <div className="flex flex-col gap-4">
      <Aviso texto={lista.erro} />
      <Legenda>Aparecem os itens perdidos, inabilitados ou desclassificados (ou em que a empresa não ficou em 1º). A análise da vencedora e a recomendação (recorrer, não recorrer, apenas registrar) são decisão do jurídico. (EM DESENVOLVIMENTO)</Legenda>
      {(lista.dados ?? []).length === 0 && !lista.carregando ? <Vazio>Nenhum item com possibilidade de recurso. Registre o resultado do item na tela do acompanhamento.</Vazio> : null}
      <div className="flex flex-col gap-2">
        {(lista.dados ?? []).map((l) => (
          <Link key={l.participacaoId} to={`/juridico/pareceres/${l.participacaoId}`} className="flex flex-col gap-1 rounded-xl bg-primary p-4 no-underline shadow-xs ring-1 ring-secondary hover:bg-primary_hover">
            <span className="flex flex-wrap items-center gap-2">
              <strong className="text-md text-primary [overflow-wrap:anywhere]"><bdi>{l.orgao ?? '—'}</bdi>{l.numeroEdital ? ` · nº ${l.numeroEdital}` : ''} · item {l.numeroItem ?? '—'}</strong>
              {l.parecerId ? <Etiqueta cor="marca">Parecer aberto</Etiqueta> : <Etiqueta cor="cinza">Sem parecer</Etiqueta>}
              {l.recomendacao ? <Etiqueta cor={l.recomendacao === 'recorrer' ? 'sucesso' : 'cinza'}>{RECOMENDACAO[l.recomendacao]}</Etiqueta> : null}
              {l.bloqueado ? <Etiqueta cor="erro">Evidência bloqueando</Etiqueta> : null}
              {l.pecaId ? <Etiqueta cor="sucesso">Peça de recurso aberta</Etiqueta> : null}
            </span>
            <Legenda>{l.item ?? ''} · {l.resultado}{l.vencedoraNome ? ` · vencedora: ${l.vencedoraNome}` : ''} · {dataHoraSP(l.ocorridoEm)}{l.achados ? ` · ${l.achados} achado(s)` : ''}</Legenda>
          </Link>
        ))}
      </div>
    </div>
  )
}
