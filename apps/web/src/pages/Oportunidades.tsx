import { useState } from 'react'
import { useAcesso } from '../features/acesso/contexto'
import { BuscarEdital, Oportunidades } from '../features/pesquisa/Oportunidades'
import { Abas, CabecalhoPagina, Pagina } from '../ui'

// Pesquisa de editais (Fase 04) da empresa selecionada. O front só esconde o que a pessoa não pode usar;
// quem decide é a API (guard + RLS).
export default function PaginaOportunidades() {
  const { empresa, pode } = useAcesso()
  const [aba, setAba] = useState<'oportunidades' | 'buscar'>('oportunidades')
  if (!empresa) return <p className="px-4 py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  if (!pode('editais', 'visualizar')) return <p className="px-4 py-10 text-center text-sm text-tertiary">Você não tem permissão para ver editais de {empresa.empresa}.</p>
  return (
    <Pagina larga key={empresa.empresaId}>
      <CabecalhoPagina titulo="Oportunidades" subtitulo={empresa.empresa} />
      <Abas
        rotulo="Pesquisa"
        ativa={aba}
        aoMudar={setAba}
        abas={[{ id: 'oportunidades', rotulo: 'Oportunidades' }, ...(pode('editais', 'cadastrar') ? [{ id: 'buscar' as const, rotulo: 'Buscar edital' }] : [])]}
      />
      {aba === 'oportunidades' ? (
        <Oportunidades empresaId={empresa.empresaId} pode={(a) => pode('editais', a)} />
      ) : (
        <BuscarEdital empresaId={empresa.empresaId} />
      )}
    </Pagina>
  )
}
