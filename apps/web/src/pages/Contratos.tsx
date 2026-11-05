import { useAcesso } from '../features/acesso/contexto'
import { Lista } from '../features/contratos/Lista'
import { Aviso, CabecalhoPagina, Pagina } from '../ui'

// Contratos e atas (Fase 11): vigência, empenhos, entregas, financeiro e histórico. Saldos são calculados, nunca digitados.
export default function Contratos() {
  const { empresa, pode } = useAcesso()
  if (!empresa) return <p className="py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  if (!pode('contratos', 'visualizar')) return <p className="py-10 text-center text-sm text-tertiary">Você não tem permissão para ver os contratos de {empresa.empresa}.</p>
  return (
    <Pagina larga>
      <CabecalhoPagina titulo="Contratos" subtitulo={empresa.empresa} />
      <Aviso tipo="info" texto="Os saldos (a empenhar, entregue, a receber) são calculados pelo sistema a partir dos registros e o banco recusa empenho ou entrega acima do saldo. Valores financeiros só aparecem para quem tem permissão no financeiro." />
      <Lista key={empresa.empresaId} empresaId={empresa.empresaId} />
    </Pagina>
  )
}
