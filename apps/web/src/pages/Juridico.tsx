import { useState } from 'react'
import { useAcesso } from '../features/acesso/contexto'
import { Base } from '../features/juridico/Base'
import { Pecas } from '../features/juridico/Pecas'
import { Pareceres } from '../features/juridico/Pareceres'
import { Sugestoes } from '../features/juridico/Sugestoes'
import { Recursos } from '../features/juridico/Recursos'
import { Abas, Aviso, CabecalhoPagina, Pagina } from '../ui'

// Módulo jurídico (Fase 10): peças com fluxo e a base jurídica verificada. A decisão é sempre de quem tem perfil jurídico; o sistema nunca protocola.
export default function Juridico() {
  const { empresa, pode } = useAcesso()
  const [aba, setAba] = useState<'pecas' | 'sugestoes' | 'recursos' | 'pareceres' | 'base'>('pecas')
  if (!empresa) return <p className="py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  if (!pode('juridico', 'visualizar')) return <p className="py-10 text-center text-sm text-tertiary">Você não tem permissão para ver o módulo jurídico de {empresa.empresa}.</p>
  return (
    <Pagina larga>
      <CabecalhoPagina titulo="Jurídico" subtitulo={empresa.empresa} />
      <Aviso tipo="atencao" texto="A minuta só pode citar lei, acórdão ou súmula que esteja na base jurídica verificada. Nenhuma peça vira documento final sem aprovação de quem tem permissão de aprovar. O sistema nunca protocola: a pessoa protocola e registra o comprovante. ⚖️ Texto de modelo e prazos seguem pendentes do jurídico." />
      <Abas rotulo="Jurídico" ativa={aba} aoMudar={(a) => setAba(a as 'pecas' | 'sugestoes' | 'recursos' | 'pareceres' | 'base')} abas={[{ id: 'pecas', rotulo: 'Peças' }, { id: 'sugestoes', rotulo: 'Sugestões' }, { id: 'recursos', rotulo: 'Recursos de terceiros' }, { id: 'pareceres', rotulo: 'Viabilidade recursal' }, { id: 'base', rotulo: 'Base jurídica' }]} />
      {aba === 'pecas' ? <Pecas key={empresa.empresaId} empresaId={empresa.empresaId} /> : aba === 'sugestoes' ? <Sugestoes key={empresa.empresaId} empresaId={empresa.empresaId} /> : aba === 'recursos' ? <Recursos key={empresa.empresaId} empresaId={empresa.empresaId} /> : aba === 'pareceres' ? <Pareceres key={empresa.empresaId} empresaId={empresa.empresaId} /> : <Base key={empresa.empresaId} empresaId={empresa.empresaId} />}
    </Pagina>
  )
}
