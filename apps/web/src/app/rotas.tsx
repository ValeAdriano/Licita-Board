import { Navigate, Outlet } from 'react-router'
import { Aviso, Botao, Card, Carregando, TelaCentral } from '../components/ui'
import type { Destino } from '../lib/auth/acesso'
import { useAuth } from '../lib/auth/AuthProvider'

export const ROTA_DE: Record<Destino, string> = {
  login: '/login',
  'cadastrar-mfa': '/mfa/cadastro',
  'verificar-mfa': '/mfa/verificar',
  liberado: '/',
}

// Só renderiza a rota se o estado de acesso estiver entre os aceitos; senão redireciona.
export function Guarda({ aceita }: { aceita: Destino[] }) {
  const { carregando, destino, falhou, recarregar, sair } = useAuth()
  if (carregando) return <Carregando />
  if (falhou) return <FalhaAoCarregar aoTentar={recarregar} aoSair={() => void sair()} />
  if (!aceita.includes(destino)) return <Navigate to={ROTA_DE[destino]} replace />
  return <Outlet />
}

function FalhaAoCarregar({ aoTentar, aoSair }: { aoTentar: () => Promise<void>; aoSair: () => void }) {
  return (
    <TelaCentral>
      <Card titulo="Não foi possível carregar seu acesso">
        <Aviso tipo="erro">Verifique sua conexão e tente de novo.</Aviso>
        <div className="flex flex-col gap-3">
          <Botao onClick={() => void aoTentar()}>Tentar de novo</Botao>
          <Botao variante="secundario" onClick={aoSair}>
            Sair
          </Botao>
        </div>
      </Card>
    </TelaCentral>
  )
}
