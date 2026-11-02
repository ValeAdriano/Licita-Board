import { Link } from 'react-router'
import { MENU } from '../../app/navegacao'

// "Mais" da barra inferior no celular: todos os módulos.
export function MenuPage() {
  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Menu</h1>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {MENU.map((item) => {
          const Icone = item.icone
          return (
            <li key={item.rota}>
              <Link
                to={item.rota}
                className="flex min-h-20 flex-col items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <Icone aria-hidden className="size-5 text-marca dark:text-sky-300" />
                <span className="font-medium">{item.rotulo}</span>
                {!item.pronto && <span className="text-[11px] uppercase text-amber-700 dark:text-amber-300">Em desenvolvimento</span>}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
