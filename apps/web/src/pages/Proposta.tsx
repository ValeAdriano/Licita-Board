import { Link, useParams } from 'react-router'
import { useAcesso } from '../features/acesso/contexto'
import { useGet } from '../features/acesso/useGet'
import { Propostas, type DadosPropostas } from '../features/propostas/Propostas'
import { Botao, CabecalhoPagina, Pagina } from '../ui'

// Propostas do acompanhamento (Fase 08): rascunho, conferência, aprovação e documento final com hash.
export default function Proposta() {
  const { id } = useParams()
  const { empresa, pode } = useAcesso()
  const empresaId = empresa?.empresaId ?? null
  const det = useGet<DadosPropostas>(empresaId && id ? `/empresas/${empresaId}/acompanhamentos/${id}/propostas` : null)
  if (!empresaId || !id) return <p className="py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  if (det.erro) return <p className="py-10 text-center text-sm text-tertiary">Propostas não encontradas ou sem permissão.</p>
  if (!det.dados) return <p className="text-sm text-tertiary">Carregando…</p>
  return (
    <Pagina larga>
      <Link to={`/agenda/acompanhamentos/${id}`}>← Acompanhamento</Link>
      <CabecalhoPagina titulo="Propostas" subtitulo={empresa?.empresa} />
      <Propostas empresaId={empresaId} acompanhamentoId={id} d={det.dados} podeCadastrar={pode('propostas', 'cadastrar')} podeEditar={pode('propostas', 'editar')} podeAprovar={pode('propostas', 'aprovar')} aoMudar={det.recarregar} />
      <div><Botao variante="texto" onClick={det.recarregar}>Atualizar</Botao></div>
    </Pagina>
  )
}
