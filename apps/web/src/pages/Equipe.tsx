import { useState } from 'react'
import { chamar, ErroApi } from '../api/cliente'
import { useAcesso, type Vinculo } from '../features/acesso/contexto'
import { ConvidarUsuario } from '../features/acesso/equipe/ConvidarUsuario'
import { EditorVinculo } from '../features/acesso/equipe/EditorVinculo'
import { convitePendente, type ConviteEmpresa, type Membro } from '../features/acesso/equipe/tipos'
import { rotuloPapel, type Modulo } from '../features/acesso/matriz'
import { useGet } from '../features/acesso/useGet'
import { Aviso, Botao, CabecalhoPagina, Etiqueta, Pagina, Table } from '../ui'

// Equipe e permissões da empresa selecionada (Prompt 1.3). O front só lê e chama a API; quem decide o
// que cada um vê e faz é o banco. Trocar de empresa remonta a tela: nada em edição vai para a errada.
export default function Equipe() {
  const { empresa } = useAcesso()
  if (!empresa) return <p className="px-4 py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  return <EquipeDaEmpresa key={empresa.empresaId} empresa={empresa} />
}

function EquipeDaEmpresa({ empresa }: { empresa: Vinculo }) {
  const { pode } = useAcesso()
  const podeVer = pode('usuarios', 'visualizar')
  const podeVerPermissoes = pode('permissoes', 'visualizar')
  // Editar a matriz exige ver as permissões (senão a tela mostraria tudo vazio e salvaria por cima).
  const podeAdministrar = pode('permissoes', 'administrar_permissoes') && podeVerPermissoes
  const usuarios = useGet<Membro[]>(podeVer ? `/empresas/${empresa.empresaId}/usuarios` : null)
  const convites = useGet<ConviteEmpresa[]>(podeVerPermissoes ? `/empresas/${empresa.empresaId}/convites` : null)
  const modulos = useGet<Modulo[]>('/modulos')
  const [editando, setEditando] = useState<string | null>(null)
  const [convidando, setConvidando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  if (!podeVer) return <p className="px-4 py-10 text-center text-sm text-tertiary">Você não tem permissão para ver os usuários de {empresa.empresa}.</p>

  const membro = usuarios.dados?.find((m) => m.vinculoId === editando)
  const pendentes = convites.dados?.filter((c) => convitePendente(c)) ?? []

  async function revogar(id: string) {
    setErro(null)
    try {
      await chamar('DELETE', `/convites/${id}`)
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível revogar o convite.')
    }
    convites.recarregar()
  }

  return (
    <Pagina larga>
      <CabecalhoPagina titulo="Equipe e permissões" subtitulo={empresa.empresa} />
      <Aviso texto={erro ?? usuarios.erro ?? convites.erro ?? modulos.erro} />

      {membro && modulos.dados ? (
        <EditorVinculo key={membro.vinculoId} membro={membro} modulos={modulos.dados} podeAdministrar={podeAdministrar} aoSalvar={usuarios.recarregar} aoFechar={() => setEditando(null)} />
      ) : convidando && modulos.dados ? (
        <ConvidarUsuario
          empresaId={empresa.empresaId}
          modulos={modulos.dados}
          aoConcluir={() => {
            setConvidando(false)
            convites.recarregar()
          }}
          aoCancelar={() => setConvidando(false)}
        />
      ) : (
        <>
          {podeAdministrar ? (
            <div>
              <Botao onClick={() => setConvidando(true)}>Convidar usuário</Botao>
            </div>
          ) : null}
          {usuarios.carregando ? <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Carregando…</p> : null}
          {usuarios.dados?.length ? <>
          <div className="hidden md:block overflow-hidden rounded-xl shadow-xs ring-1 ring-secondary">
            <Table aria-label="Equipe" size="sm">
              <Table.Header><Table.Head id="nome" isRowHeader label="Usuário" /><Table.Head id="papel" label="Papel" /><Table.Head id="situacao" label="Situação" /></Table.Header>
              <Table.Body items={usuarios.dados.map((m) => ({ ...m, key: m.vinculoId }))}>{(m) => <Table.Row id={m.vinculoId} onAction={() => setEditando(m.vinculoId)}><Table.Cell><strong>{m.nome || m.email}</strong><span className="block text-tertiary">{m.email}</span></Table.Cell><Table.Cell>{rotuloPapel(m.papel)}</Table.Cell><Table.Cell>{m.ativo ? 'ativo' : 'inativo'}</Table.Cell></Table.Row>}</Table.Body>
            </Table>
          </div>
          <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary md:hidden">
            {usuarios.dados.map((m) => (
              <button key={m.vinculoId} type="button" className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setEditando(m.vinculoId)}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
                  <strong>{m.nome || m.email}</strong>
                  <span className="text-sm text-tertiary [overflow-wrap:anywhere]">{m.email}</span>
                </span>
                <Etiqueta>{rotuloPapel(m.papel)}</Etiqueta>
                {!m.ativo ? <Etiqueta>inativo</Etiqueta> : null}
              </button>
            ))}
          </div>
          </> : null}
          {podeVerPermissoes ? (
            <>
              <h2>Convites pendentes</h2>
              {pendentes.length === 0 ? <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Nenhum convite pendente.</p> : null}
              {pendentes.length ? <><div className="hidden md:block overflow-hidden rounded-xl shadow-xs ring-1 ring-secondary">
                <Table aria-label="Convites pendentes" size="sm"><Table.Header><Table.Head id="email" isRowHeader label="E-mail" /><Table.Head id="papel" label="Papel e validade" /><Table.Head id="acao" label="Ações" /></Table.Header><Table.Body items={pendentes.map((c) => ({ ...c, key: c.id }))}>{(c) => <Table.Row id={c.id}><Table.Cell>{c.email}</Table.Cell><Table.Cell>{rotuloPapel(c.papel)} · expira em {new Date(c.expiraEm).toLocaleDateString('pt-BR')}</Table.Cell><Table.Cell>{podeAdministrar ? <Botao variante="secundario" onClick={() => void revogar(c.id)}>Revogar convite</Botao> : null}</Table.Cell></Table.Row>}</Table.Body></Table>
              </div><div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary md:hidden">
                {pendentes.map((c) => (
                  <div key={c.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
                      <strong>{c.email}</strong>
                      <span className="text-sm text-tertiary [overflow-wrap:anywhere]">
                        {rotuloPapel(c.papel)} · expira em {new Date(c.expiraEm).toLocaleDateString('pt-BR')}
                      </span>
                    </span>
                    {podeAdministrar ? (
                      <Botao variante="secundario" onClick={() => void revogar(c.id)}>
                        Revogar convite
                      </Botao>
                    ) : null}
                  </div>
                ))}
              </div>
              </> : null}
            </>
          ) : null}
        </>
      )}
    </Pagina>
  )
}
