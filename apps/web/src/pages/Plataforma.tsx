import { useState } from 'react'
import { useAcesso } from '../features/acesso/contexto'
import { Empresas } from '../features/acesso/plataforma/Empresas'
import { Exclusoes } from '../features/acesso/plataforma/Exclusoes'
import { Botao } from '../ui'

// Plataforma (Prompt 1.2): empresas clientes e exclusão definitiva com dupla aprovação. Só SUPERADMIN;
// a API recusa os demais mesmo que alguém abra o endereço à mão.
export default function Plataforma() {
  const { usuario } = useAcesso()
  const [aba, setAba] = useState<'empresas' | 'exclusoes'>('empresas')
  if (!usuario?.superadmin) return <p className="vazio">Esta área é só da equipe da plataforma.</p>
  return (
    <div className="conteudo__miolo conteudo__miolo--largo entra">
      <h1>Plataforma</h1>
      <div role="tablist" aria-label="Plataforma" className="pilha" style={{ flexDirection: 'row' }}>
        <Botao role="tab" aria-selected={aba === 'empresas'} variante={aba === 'empresas' ? 'primario' : 'secundario'} onClick={() => setAba('empresas')}>
          Empresas
        </Botao>
        <Botao role="tab" aria-selected={aba === 'exclusoes'} variante={aba === 'exclusoes' ? 'primario' : 'secundario'} onClick={() => setAba('exclusoes')}>
          Exclusões
        </Botao>
      </div>
      {aba === 'empresas' ? <Empresas /> : <Exclusoes />}
    </div>
  )
}
