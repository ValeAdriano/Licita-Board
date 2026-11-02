import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from './app/router'
import { EnvBanner } from './components/EnvBanner'
import { Aviso, Card, TelaCentral } from './components/ui'
import { supabaseConfigurado } from './lib/supabase'
import './index.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })

function ConfiguracaoAusente() {
  return (
    <>
      <EnvBanner />
      <TelaCentral>
        <Card titulo="Configuração ausente">
          <Aviso tipo="erro">
            Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em apps/web/.env.local (veja .env.example).
          </Aviso>
        </Card>
      </TelaCentral>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {supabaseConfigurado ? (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    ) : (
      <ConfiguracaoAusente />
    )}
  </StrictMode>,
)
