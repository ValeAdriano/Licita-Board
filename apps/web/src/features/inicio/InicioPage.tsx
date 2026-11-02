import { Link } from 'react-router'
import { MODULOS_EM_DESENVOLVIMENTO } from '../../app/navegacao'
import { Aviso } from '../../components/ui'
import { useAuth } from '../../lib/auth/AuthProvider'
import { nomeDaEmpresa, useEmpresaAtiva } from '../../lib/empresa/EmpresaAtiva'

export function InicioPage() {
  const { perfil } = useAuth()
  const { ativa, empresas, carregando } = useEmpresaAtiva()

  return (
    <div className="mx-auto max-w-5xl p-4">
      <h1 className="mb-1 text-2xl font-semibold">Olá{perfil?.nome ? `, ${perfil.nome}` : ''}</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        {carregando ? 'Carregando empresas…' : ativa ? `Empresa ativa: ${nomeDaEmpresa(ativa)}` : ''}
      </p>

      {!carregando && empresas.length === 0 && (
        <Aviso>Você ainda não tem acesso a nenhuma empresa. Fale com o administrador.</Aviso>
      )}

      <h2 className="mb-3 text-lg font-semibold">Módulos</h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MODULOS_EM_DESENVOLVIMENTO.map((m) => {
          const Icone = m.icone
          return (
            <li key={m.rota}>
              <Link
                to={m.rota}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <Icone aria-hidden className="size-5 text-marca dark:text-sky-300" />
                <span className="font-medium">{m.rotulo}</span>
                <span className="ml-auto text-[11px] uppercase text-amber-700 dark:text-amber-300">Em desenvolvimento</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
