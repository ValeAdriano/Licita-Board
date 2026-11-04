import { useState } from 'react'
import { useAcesso, type Vinculo } from '../features/acesso/contexto'
import { Atestados } from '../features/acesso/cadastros/Atestados'
import { Documentos } from '../features/acesso/cadastros/Documentos'
import { Contas } from '../features/acesso/cadastros/Contas'
import { EmpresaFicha } from '../features/acesso/cadastros/EmpresaFicha'
import { PalavrasChave } from '../features/acesso/cadastros/PalavrasChave'
import { Produtos } from '../features/acesso/cadastros/Produtos'
import { Representantes } from '../features/acesso/cadastros/Representantes'
import { Abas, CabecalhoPagina, Pagina } from '../ui'

type Aba = 'empresa' | 'contas' | 'representantes' | 'documentos' | 'atestados' | 'produtos' | 'palavras'

// Cadastros da empresa selecionada (Fase 02): ficha, contas, representantes, produtos e palavras-chave.
// O front só esconde o que a pessoa não pode usar; quem decide é a API (guard + RLS).
export default function Cadastros() {
  const { empresa } = useAcesso()
  if (!empresa) return <p className="px-4 py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  return <CadastrosDaEmpresa key={empresa.empresaId} empresa={empresa} />
}

function CadastrosDaEmpresa({ empresa }: { empresa: Vinculo }) {
  const { pode } = useAcesso()
  const abas: { id: Aba; rotulo: string; visivel: boolean }[] = [
    { id: 'empresa', rotulo: 'Empresa', visivel: pode('empresas', 'visualizar') },
    { id: 'contas', rotulo: 'Contas e PIX', visivel: pode('empresas', 'visualizar') },
    { id: 'representantes', rotulo: 'Representantes', visivel: pode('representantes', 'visualizar') },
    { id: 'documentos', rotulo: 'Documentos', visivel: pode('documentos', 'visualizar') },
    { id: 'atestados', rotulo: 'Atestados', visivel: pode('documentos', 'visualizar') },
    { id: 'produtos', rotulo: 'Produtos', visivel: pode('produtos', 'visualizar') },
    { id: 'palavras', rotulo: 'Palavras-chave', visivel: pode('produtos', 'visualizar') },
  ]
  const visiveis = abas.filter((a) => a.visivel)
  const [aba, setAba] = useState<Aba | null>(null)
  const ativa = aba ?? visiveis[0]?.id
  if (!ativa) return <p className="px-4 py-10 text-center text-sm text-tertiary">Você não tem permissão para ver os cadastros de {empresa.empresa}.</p>
  const id = empresa.empresaId
  return (
    <Pagina larga>
      <CabecalhoPagina titulo="Cadastros" subtitulo={empresa.empresa} />
      <Abas rotulo="Cadastros" ativa={ativa} aoMudar={setAba} abas={visiveis.map((a) => ({ id: a.id, rotulo: a.rotulo }))} />
      {ativa === 'empresa' ? <EmpresaFicha empresaId={id} podeEditar={pode('empresas', 'editar')} /> : null}
      {ativa === 'contas' ? <Contas empresaId={id} podeEditar={pode('empresas', 'editar')} /> : null}
      {ativa === 'representantes' ? <Representantes empresaId={id} pode={(a) => pode('representantes', a)} /> : null}
      {ativa === 'documentos' ? <Documentos empresaId={id} pode={(a) => pode('documentos', a)} /> : null}
      {ativa === 'atestados' ? <Atestados empresaId={id} pode={(a) => pode('documentos', a)} /> : null}
      {ativa === 'produtos' ? <Produtos empresaId={id} pode={(a) => pode('produtos', a)} /> : null}
      {ativa === 'palavras' ? <PalavrasChave empresaId={id} pode={(a) => pode('produtos', a)} /> : null}
    </Pagina>
  )
}
