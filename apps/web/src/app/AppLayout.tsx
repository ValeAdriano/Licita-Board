import { Outlet } from 'react-router'
import { useAuth } from '../lib/auth/AuthProvider'

// Casca mínima das telas logadas. Menu lateral, bottom nav e seletor de empresa vêm no PR do shell.
// O logout por inatividade fica no AuthProvider e vale para todas as rotas com sessão.
export function AppLayout() {
  const { sair } = useAuth()
  return (
    <>
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <span className="font-semibold text-marca dark:text-sky-300">VV Licitações</span>
        <button type="button" onClick={() => void sair()} className="min-h-11 px-2 text-sm underline">
          Sair
        </button>
      </header>
      <Outlet />
    </>
  )
}
