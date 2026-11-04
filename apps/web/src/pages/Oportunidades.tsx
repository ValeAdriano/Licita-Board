import { useState } from 'react'
import { useAcesso } from '../features/acesso/contexto'
import { BuscarEdital, Oportunidades } from '../features/pesquisa/Oportunidades'
import { Botao } from '../ui'

// Pesquisa de editais (Fase 04) da empresa selecionada. O front só esconde o que a pessoa não pode usar;
// quem decide é a API (guard + RLS).
export default function PaginaOportunidades() {
  const { empresa, pode } = useAcesso()
  const [aba, setAba] = useState<'oportunidades' | 'buscar'>('oportunidades')
  if (!empresa) return <p className="vazio">Selecione uma empresa.</p>
  if (!pode('editais', 'visualizar')) return <p className="vazio">Você não tem permissão para ver editais de {empresa.empresa}.</p>
  return (
    <div className="conteudo__miolo conteudo__miolo--largo entra" key={empresa.empresaId}>
      <div>
        <h1>Oportunidades</h1>
        <p className="legenda">{empresa.empresa}</p>
      </div>
      <div role="tablist" aria-label="Pesquisa" className="pilha" style={{ flexDirection: 'row' }}>
        <Botao role="tab" aria-selected={aba === 'oportunidades'} variante={aba === 'oportunidades' ? 'primario' : 'secundario'} onClick={() => setAba('oportunidades')}>
          Oportunidades
        </Botao>
        {pode('editais', 'cadastrar') ? (
          <Botao role="tab" aria-selected={aba === 'buscar'} variante={aba === 'buscar' ? 'primario' : 'secundario'} onClick={() => setAba('buscar')}>
            Buscar edital
          </Botao>
        ) : null}
      </div>
      {aba === 'oportunidades' ? (
        <Oportunidades empresaId={empresa.empresaId} pode={(a) => pode('editais', a)} />
      ) : (
        <BuscarEdital empresaId={empresa.empresaId} />
      )}
    </div>
  )
}
