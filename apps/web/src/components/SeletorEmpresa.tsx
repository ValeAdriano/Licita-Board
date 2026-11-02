import { nomeDaEmpresa, useEmpresaAtiva } from '../lib/empresa/EmpresaAtiva'

// <select> nativo: no celular abre o seletor do próprio sistema, que já é acessível e grande.
export function SeletorEmpresa() {
  const { empresas, ativa, selecionar, carregando } = useEmpresaAtiva()
  if (carregando) return <p className="text-sm text-slate-500">Carregando empresas…</p>
  if (empresas.length === 0) return <p className="text-sm text-slate-500">Nenhuma empresa acessível</p>
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Empresa</span>
      <select
        value={ativa?.id ?? ''}
        onChange={(e) => selecionar(e.target.value)}
        className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
      >
        {empresas.map((e) => (
          <option key={e.id} value={e.id}>
            {nomeDaEmpresa(e)}
          </option>
        ))}
      </select>
    </label>
  )
}
