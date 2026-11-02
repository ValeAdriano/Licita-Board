import { Bell, LogOut, Menu, WifiOff } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router'
import { SeletorEmpresa } from '../components/SeletorEmpresa'
import { useAuth } from '../lib/auth/AuthProvider'
import { EmpresaAtivaProvider } from '../lib/empresa/EmpresaAtiva'
import { useNaoLidas } from '../lib/notificacoes'
import { useOnline } from '../lib/useOnline'
import { type ItemMenu, MENU } from './navegacao'

function Selo() {
  return (
    <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900 dark:bg-amber-900 dark:text-amber-100">
      em dev
    </span>
  )
}

function LinkLateral({ item }: { item: ItemMenu }) {
  const Icone = item.icone
  return (
    <NavLink
      to={item.rota}
      end={item.rota === '/'}
      className={({ isActive }) =>
        `flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm ${
          isActive ? 'bg-marca text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
        }`
      }
    >
      <Icone aria-hidden className="size-4 shrink-0" />
      <span>{item.rotulo}</span>
      {!item.pronto && <Selo />}
    </NavLink>
  )
}

function Sino() {
  const { session } = useAuth()
  const naoLidas = useNaoLidas(session?.user.id)
  const total = naoLidas.data ?? 0
  return (
    <Link
      to="/notificacoes"
      aria-label={total ? `Notificações: ${total} não lidas` : 'Notificações'}
      className="relative inline-flex size-11 items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      <Bell aria-hidden className="size-5" />
      {total > 0 && (
        <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white">
          {total > 99 ? '99+' : total}
        </span>
      )}
    </Link>
  )
}

// Shell do app (Prompt 1.1): menu lateral no desktop, barra inferior no celular (mobile-first),
// seletor de empresa, notificações. O logout por inatividade fica no AuthProvider.
export function AppLayout() {
  const { sair } = useAuth()
  const online = useOnline()
  const barra = MENU.filter((i) => i.barraInferior)

  return (
    <EmpresaAtivaProvider>
      <div className="md:flex">
        <aside className="hidden md:sticky md:top-[var(--altura-faixa)] md:flex md:h-[calc(100dvh-var(--altura-faixa))] md:w-64 md:shrink-0 md:flex-col md:gap-4 md:border-r md:border-slate-200 md:bg-white md:p-4 dark:md:border-slate-800 dark:md:bg-slate-900">
          <Link to="/" className="text-lg font-semibold text-marca dark:text-sky-300">
            VV Licitações
          </Link>
          <SeletorEmpresa />
          <nav aria-label="Menu principal" className="flex flex-1 flex-col gap-1 overflow-y-auto">
            {MENU.map((item) => (
              <LinkLateral key={item.rota} item={item} />
            ))}
          </nav>
          <button
            type="button"
            onClick={() => void sair()}
            className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <LogOut aria-hidden className="size-4" /> Sair
          </button>
        </aside>

        <div className="min-w-0 flex-1 pb-20 md:pb-0">
          <header className="sticky top-[var(--altura-faixa)] z-40 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
            <div className="flex items-center gap-2">
              <Link to="/" className="font-semibold text-marca md:hidden dark:text-sky-300">
                VV Licitações
              </Link>
              <div className="ml-auto flex items-center">
                <Sino />
              </div>
            </div>
            <div className="mt-2 md:hidden">
              <SeletorEmpresa />
            </div>
          </header>
          {!online && (
            <div role="status" className="flex items-center gap-2 bg-slate-800 px-4 py-2 text-sm text-white">
              <WifiOff aria-hidden className="size-4" /> Sem conexão. As informações podem estar desatualizadas.
            </div>
          )}
          <Outlet />
        </div>

        <nav
          aria-label="Navegação inferior"
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden dark:border-slate-800 dark:bg-slate-900"
        >
          {barra.map((item) => {
            const Icone = item.icone
            return (
              <NavLink
                key={item.rota}
                to={item.rota}
                end={item.rota === '/'}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? 'text-marca dark:text-sky-300' : 'text-slate-500'}`
                }
              >
                <Icone aria-hidden className="size-5" />
                {item.rotulo}
              </NavLink>
            )
          })}
          <NavLink
            to="/menu"
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? 'text-marca dark:text-sky-300' : 'text-slate-500'}`
            }
          >
            <Menu aria-hidden className="size-5" />
            Mais
          </NavLink>
        </nav>
      </div>
    </EmpresaAtivaProvider>
  )
}
