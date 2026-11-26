import { Link } from 'react-router'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'

interface Ficha { logradouro: string | null; municipio: string | null; uf: string | null; cep: string | null; regimeTributario: string | null }

// Onboarding depois do cadastro: o que falta para a empresa começar a usar o sistema. Calculado dos próprios
// registros (nada é gravado sobre o progresso) e some sozinho quando tudo estiver preenchido.
export function PrimeirosPassos() {
  const { empresa, pode } = useAcesso()
  if (empresa?.papel !== 'ADMIN_EMPRESA') return null
  return <Lista key={empresa.empresaId} base={`/empresas/${empresa.empresaId}`} pode={pode} />
}

function Lista({ base, pode }: { base: string; pode: (modulo: string, acao: string) => boolean }) {
  const ve = (modulo: string, sufixo: string) => (pode(modulo, 'visualizar') ? base + sufixo : null)
  const ficha = useGet<Ficha>(ve('empresas', ''))
  const representantes = useGet<unknown[]>(ve('representantes', '/representantes'))
  const documentos = useGet<unknown[]>(ve('documentos', '/documentos'))
  const palavras = useGet<{ termos: unknown[] }>(ve('produtos', '/palavras-chave'))
  const f = ficha.dados

  // feito: undefined = sem permissão, carregando ou com erro; o passo não aparece (nunca marca o que não sabe).
  const passos = [
    { aba: 'empresa', rotulo: 'Completar dados da empresa', dica: 'Endereço e regime tributário.', feito: f && [f.logradouro, f.municipio, f.uf, f.cep, f.regimeTributario].every(Boolean) },
    { aba: 'representantes', rotulo: 'Cadastrar representante', dica: 'Quem assina propostas e declarações.', feito: representantes.dados && representantes.dados.length > 0 },
    { aba: 'documentos', rotulo: 'Enviar documentos de habilitação', dica: 'Certidões com validade, para receber os alertas.', feito: documentos.dados && documentos.dados.length > 0 },
    { aba: 'palavras', rotulo: 'Definir palavras-chave', dica: 'É o que encontra os editais para você.', feito: palavras.dados && palavras.dados.termos.length > 0 },
  ].filter((p) => p.feito !== undefined)

  const feitos = passos.filter((p) => p.feito).length
  if (feitos === passos.length) return null
  return (
    <section aria-labelledby="primeiros-passos" className="flex flex-col gap-3 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="primeiros-passos" className="text-lg font-semibold text-primary">Primeiros passos</h2>
        <p className="text-sm text-tertiary">{feitos} de {passos.length} concluídos</p>
      </div>
      <ol className="flex flex-col divide-y divide-secondary">
        {passos.map((p) => (
          <li key={p.aba} className="py-3">
            {p.feito ? (
              <span className="text-sm text-tertiary line-through">{p.rotulo}<span className="sr-only"> (concluído)</span></span>
            ) : (
              <Link to={`/cadastros?aba=${p.aba}`} className="flex flex-col gap-0.5 no-underline">
                <span className="text-sm font-semibold text-primary">{p.rotulo} →</span>
                <span className="text-sm text-tertiary">{p.dica}</span>
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
