import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Aviso, Botao } from '../../../ui'
import { cnpjLegivel } from '../cnpj'
import { useAcesso } from '../contexto'
import { useGet } from '../useGet'
import { NovaEmpresa } from './NovaEmpresa'
import { SolicitarExclusao } from './SolicitarExclusao'
import type { EmpresaPlataforma } from './tipos'

// Empresas clientes (só SUPERADMIN): cadastrar, abrir (para convidar o administrador em Equipe) e
// pedir a exclusão definitiva.
export function Empresas() {
  const { escolherEmpresa, recarregar } = useAcesso()
  const navegar = useNavigate()
  const empresas = useGet<EmpresaPlataforma[]>('/empresas')
  const [nova, setNova] = useState(false)
  const [excluindo, setExcluindo] = useState<EmpresaPlataforma | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  if (nova) {
    return (
      <NovaEmpresa
        aoCancelar={() => setNova(false)}
        aoConcluir={() => {
          setNova(false)
          setAviso('Empresa cadastrada. Abra-a para convidar o administrador.')
          empresas.recarregar()
          void recarregar()
        }}
      />
    )
  }
  if (excluindo) {
    return (
      <SolicitarExclusao
        empresa={excluindo}
        aoCancelar={() => setExcluindo(null)}
        aoConcluir={() => {
          setExcluindo(null)
          setAviso('Pedido registrado. Outro SUPERADMIN precisa aprová-lo em Exclusões.')
        }}
      />
    )
  }
  return (
    <div className="pilha pilha--grande">
      <div>
        <Botao onClick={() => setNova(true)}>Nova empresa</Botao>
      </div>
      {aviso ? <p role="status">{aviso}</p> : null}
      <Aviso texto={empresas.erro} />
      {empresas.carregando ? <p className="legenda">Carregando…</p> : null}
      {empresas.dados?.length === 0 ? <p className="vazio">Nenhuma empresa cadastrada.</p> : null}
      <div className="lista">
        {empresas.dados?.map((e) => (
          <div key={e.id} className="lista__item lista__item--acoes" style={{ cursor: 'default' }}>
            <span className="lista__texto">
              <strong>
                <bdi>{e.razaoSocial}</bdi>
              </strong>
              <span className="legenda">CNPJ {cnpjLegivel(e.cnpj)}</span>
            </span>
            <span className="lista__acoes">
              <Botao
                variante="secundario"
                aria-label={`Abrir ${e.razaoSocial}`}
                onClick={() => {
                  escolherEmpresa(e.id)
                  void navegar('/equipe')
                }}
              >
                Abrir
              </Botao>
              <Botao variante="texto" aria-label={`Excluir definitivamente ${e.razaoSocial}`} onClick={() => setExcluindo(e)}>
                Excluir…
              </Botao>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
