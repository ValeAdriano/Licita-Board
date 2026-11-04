// Primeiro: tira o token de redefinição da URL antes de qualquer outra coisa (auth/fragmento.ts).
import './auth/fragmento'
import './styles/globals.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { RouterProvider } from 'react-aria-components'
import { BrowserRouter, useHref, useNavigate } from 'react-router'
import { Rotas } from './App'
import { SessaoProvider } from './auth/sessao'

// Service worker (só os arquivos do app): versão nova assume na hora e recarrega, para correção de
// segurança do front não ficar presa em aba antiga (T5.23).
registerSW({ immediate: true })

// Links e botões do Untitled UI (react-aria) navegam pelo roteador do app, sem recarregar a página.
function Raiz() {
  const navegar = useNavigate()
  return (
    <RouterProvider navigate={navegar} useHref={useHref}>
      <SessaoProvider>
        <Rotas />
      </SessaoProvider>
    </RouterProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Raiz />
    </BrowserRouter>
  </StrictMode>,
)
