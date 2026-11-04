import { useState } from 'react'
import { useAcesso } from '../features/acesso/contexto'
import { Cobertura } from '../features/pesquisa/Cobertura'
import { Catalogo } from '../features/acesso/cadastros/Catalogo'
import { Empresas } from '../features/acesso/plataforma/Empresas'
import { Exclusoes } from '../features/acesso/plataforma/Exclusoes'
import { Abas, CabecalhoPagina, Pagina } from '../ui'

// Plataforma (Prompt 1.2): empresas clientes e exclusão definitiva com dupla aprovação. Só SUPERADMIN;
// a API recusa os demais mesmo que alguém abra o endereço à mão.
export default function Plataforma() {
  const { usuario } = useAcesso()
  const [aba, setAba] = useState<'empresas' | 'catalogo' | 'cobertura' | 'exclusoes'>('empresas')
  if (!usuario?.superadmin) return <p className="px-4 py-10 text-center text-sm text-tertiary">Esta área é só da equipe da plataforma.</p>
  return (
    <Pagina larga>
      <CabecalhoPagina titulo="Plataforma" subtitulo="Empresas clientes, catálogo, cobertura da pesquisa e exclusões." />
      <Abas
        rotulo="Plataforma"
        ativa={aba}
        aoMudar={setAba}
        abas={[
          { id: 'empresas', rotulo: 'Empresas' },
          { id: 'catalogo', rotulo: 'Catálogo' },
          { id: 'cobertura', rotulo: 'Cobertura' },
          { id: 'exclusoes', rotulo: 'Exclusões' },
        ]}
      />
      {aba === 'empresas' ? <Empresas /> : aba === 'catalogo' ? <Catalogo /> : aba === 'cobertura' ? <Cobertura /> : <Exclusoes />}
    </Pagina>
  )
}
