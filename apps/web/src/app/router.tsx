import { createBrowserRouter, Navigate, Outlet } from 'react-router'
import { EnvBanner } from '../components/EnvBanner'
import { LoginPage } from '../features/auth/LoginPage'
import { MfaCadastroPage } from '../features/auth/MfaCadastroPage'
import { MfaVerificarPage } from '../features/auth/MfaVerificarPage'
import { RecuperarSenhaPage } from '../features/auth/RecuperarSenhaPage'
import { RedefinirSenhaPage } from '../features/auth/RedefinirSenhaPage'
import { SessoesPage } from '../features/conta/SessoesPage'
import { InicioPage } from '../features/inicio/InicioPage'
import { AuthProvider } from '../lib/auth/AuthProvider'
import { AppLayout } from './AppLayout'
import { Guarda } from './rotas'

function Raiz() {
  return (
    <AuthProvider>
      <EnvBanner />
      <Outlet />
    </AuthProvider>
  )
}

export const rotas = [
  {
    element: <Raiz />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/recuperar-senha', element: <RecuperarSenhaPage /> },
      { path: '/redefinir-senha', element: <RedefinirSenhaPage /> },
      { element: <Guarda aceita={['verificar-mfa']} />, children: [{ path: '/mfa/verificar', element: <MfaVerificarPage /> }] },
      { element: <Guarda aceita={['cadastrar-mfa']} />, children: [{ path: '/mfa/cadastro', element: <MfaCadastroPage /> }] },
      {
        element: <Guarda aceita={['liberado']} />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { path: '/', element: <InicioPage /> },
              { path: '/conta/sessoes', element: <SessoesPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]

export const router = createBrowserRouter(rotas)
