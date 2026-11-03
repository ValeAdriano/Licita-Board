// Primeiro: tira o token de redefinição da URL antes de qualquer outra coisa (auth/fragmento.ts).
import './auth/fragmento'
import './ui/estilos.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { BrowserRouter } from 'react-router'
import { Rotas } from './App'
import { SessaoProvider } from './auth/sessao'

// Service worker (só os arquivos do app): versão nova assume na hora e recarrega, para correção de
// segurança do front não ficar presa em aba antiga (T5.23).
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessaoProvider>
        <Rotas />
      </SessaoProvider>
    </BrowserRouter>
  </StrictMode>,
)
