import { useState } from 'react'
import { useAcesso, type Vinculo } from '../features/acesso/contexto'
import { Contas } from '../features/acesso/cadastros/Contas'
import { EmpresaFicha } from '../features/acesso/cadastros/EmpresaFicha'
import { PalavrasChave } from '../features/acesso/cadastros/PalavrasChave'
import { Produtos } from '../features/acesso/cadastros/Produtos'
import { Representantes } from '../features/acesso/cadastros/Representantes'
import { Botao } from '../ui'

type Aba = 'empresa' | 'contas' | 'representantes' | 'produtos' | 'palavras'

// Cadastros da empresa selecionada (Fase 02): ficha, contas, representantes, produtos e palavras-chave.
// O front só esconde o que a pessoa não pode usar; quem decide é a API (guard + RLS).
export default function Cadastros() {
  const { empresa } = useAcesso()
  if (!empresa) return <p className="vazio">Selecione uma empresa.</p>
  return <CadastrosDaEmpresa key={empresa.empresaId} empresa={empresa} />
}

function CadastrosDaEmpresa({ empresa }: { empresa: Vinculo }) {
  const { pode } = useAcesso()
  const abas: { id: Aba; rotulo: string; visivel: boolean }[] = [
    { id: 'empresa', rotulo: 'Empresa', visivel: pode('empresas', 'visualizar') },
    { id: 'contas', rotulo: 'Contas e PIX', visivel: pode('empresas', 'visualizar') },
    { id: 'representantes', rotulo: 'Representantes', visivel: pode('representantes', 'visualizar') },
    { id: 'produtos', rotulo: 'Produtos', visivel: pode('produtos', 'visualizar') },
    { id: 'palavras', rotulo: 'Palavras-chave', visivel: pode('produtos', 'visualizar') },
  ]
  const visiveis = abas.filter((a) => a.visivel)
  const [aba, setAba] = useState<Aba | null>(null)
  const ativa = aba ?? visiveis[0]?.id
  if (!ativa) return <p className="vazio">Você não tem permissão para ver os cadastros de {empresa.empresa}.</p>
  const id = empresa.empresaId
  return (
    <div className="conteudo__miolo conteudo__miolo--largo entra">
      <div>
        <h1>Cadastros</h1>
        <p className="legenda">{empresa.empresa}</p>
      </div>
      <div role="tablist" aria-label="Cadastros" className="pilha" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {visiveis.map((a) => (
          <Botao key={a.id} role="tab" aria-selected={ativa === a.id} variante={ativa === a.id ? 'primario' : 'secundario'} onClick={() => setAba(a.id)}>
            {a.rotulo}
          </Botao>
        ))}
      </div>
      {ativa === 'empresa' ? <EmpresaFicha empresaId={id} podeEditar={pode('empresas', 'editar')} /> : null}
      {ativa === 'contas' ? <Contas empresaId={id} podeEditar={pode('empresas', 'editar')} /> : null}
      {ativa === 'representantes' ? <Representantes empresaId={id} pode={(a) => pode('representantes', a)} /> : null}
      {ativa === 'produtos' ? <Produtos empresaId={id} pode={(a) => pode('produtos', a)} /> : null}
      {ativa === 'palavras' ? <PalavrasChave empresaId={id} pode={(a) => pode('produtos', a)} /> : null}
    </div>
  )
}
