import { createBrowserRouter, Navigate, Outlet } from 'react-router'
import { EnvBanner } from '../components/EnvBanner'
import { LoginPage } from '../features/auth/LoginPage'
import { MfaCadastroPage } from '../features/auth/MfaCadastroPage'
import { MfaVerificarPage } from '../features/auth/MfaVerificarPage'
import { RecuperarSenhaPage } from '../features/auth/RecuperarSenhaPage'
import { RedefinirSenhaPage } from '../features/auth/RedefinirSenhaPage'
import { ContaPage } from '../features/conta/ContaPage'
import { SessoesPage } from '../features/conta/SessoesPage'
import { InicioPage } from '../features/inicio/InicioPage'
import { EmDesenvolvimentoPage } from '../features/modulos/EmDesenvolvimentoPage'
import { MenuPage } from '../features/modulos/MenuPage'
import { NotificacoesPage } from '../features/notificacoes/NotificacoesPage'
import { AuthProvider } from '../lib/auth/AuthProvider'
import { AppLayout } from './AppLayout'
import { MODULOS_EM_DESENVOLVIMENTO } from './navegacao'
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
              { path: '/conta', element: <ContaPage /> },
              { path: '/conta/sessoes', element: <SessoesPage /> },
              { path: '/notificacoes', element: <NotificacoesPage /> },
              { path: '/menu', element: <MenuPage /> },
              ...MODULOS_EM_DESENVOLVIMENTO.map((m) => ({
                path: m.rota,
                element: <EmDesenvolvimentoPage modulo={m.rotulo} fase={m.fase} />,
              })),
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]

export const router = createBrowserRouter(rotas)
