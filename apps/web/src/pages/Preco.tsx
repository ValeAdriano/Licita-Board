import { Link, useParams } from 'react-router'
import { useAcesso } from '../features/acesso/contexto'
import { useGet } from '../features/acesso/useGet'
import { Calculadora, type DadosPreco } from '../features/precos/Calculadora'
import { Botao, CabecalhoPagina, Etiqueta, Pagina } from '../ui'

// Formação de preços de um item (Fase 07). Custos e margens são sigilo comercial: só quem tem "Ver custos e margens" acessa.
export default function Preco() {
  const { id } = useParams()
  const { empresa, pode } = useAcesso()
  const empresaId = empresa?.empresaId ?? null
  const det = useGet<DadosPreco>(empresaId && id ? `/empresas/${empresaId}/participacoes/${id}/preco` : null)
  if (!empresaId || !id) return <p className="py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  if (det.erro) return <p className="py-10 text-center text-sm text-tertiary">Preço não encontrado ou sem permissão para ver custos e margens.</p>
  if (!det.dados) return <p className="text-sm text-tertiary">Carregando…</p>
  const d = det.dados
  return (
    <Pagina larga>
      <Link to="/agenda">← Agenda</Link>
      <CabecalhoPagina titulo={`Formação de preços · item ${d.item?.numeroItem ?? ''}`} subtitulo={`${d.item?.descricao ?? ''}`.slice(0, 200)} acoes={<Etiqueta cor="aviso">Custos e margens: sigilo comercial</Etiqueta>} />
      <Calculadora empresaId={empresaId} participacaoId={id} d={d} podeEditar={pode('precos', 'editar')} podeAprovar={pode('precos', 'aprovar')} aoMudar={det.recarregar} />
      <div><Botao variante="texto" onClick={det.recarregar}>Atualizar</Botao></div>
    </Pagina>
  )
}
