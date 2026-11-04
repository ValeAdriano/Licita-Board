import { useMemo, useState } from 'react'
import { useAcesso, type Vinculo } from '../features/acesso/contexto'
import { descricao, nomeDoAutor, rotuloTabela, type Registro } from '../features/acesso/auditoria/rotulos'
import type { Membro } from '../features/acesso/equipe/tipos'
import { useGet } from '../features/acesso/useGet'
import { Aviso, CabecalhoPagina, Pagina, Selecao } from '../ui'

// Auditoria da empresa (Prompt 1.4, RF-01.2): quem fez o quê e quando. Só leitura; o registro é
// imutável no banco. A API devolve os 200 mais recentes e só para quem tem auditoria/visualizar.
export default function Auditoria() {
  const { empresa } = useAcesso()
  if (!empresa) return <p className="px-4 py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  return <AuditoriaDaEmpresa key={empresa.empresaId} empresa={empresa} />
}

function AuditoriaDaEmpresa({ empresa }: { empresa: Vinculo }) {
  const { pode } = useAcesso()
  const podeVer = pode('auditoria', 'visualizar')
  const registros = useGet<Registro[]>(podeVer ? `/empresas/${empresa.empresaId}/auditoria` : null)
  const usuarios = useGet<Membro[]>(podeVer && pode('usuarios', 'visualizar') ? `/empresas/${empresa.empresaId}/usuarios` : null)
  const [tabela, setTabela] = useState('')

  const nomes = useMemo(() => new Map((usuarios.dados ?? []).map((m) => [m.usuarioId, m.nome || m.email])), [usuarios.dados])
  const tabelas = useMemo(() => [...new Set((registros.dados ?? []).map((r) => r.tabela))].sort(), [registros.dados])
  const lista = (registros.dados ?? []).filter((r) => !tabela || r.tabela === tabela)

  if (!podeVer) return <p className="px-4 py-10 text-center text-sm text-tertiary">Você não tem permissão para ver a auditoria de {empresa.empresa}.</p>
  return (
    <Pagina larga>
      <CabecalhoPagina titulo="Auditoria" subtitulo={`${empresa.empresa} · as 200 ações mais recentes`} />
      <Aviso texto={registros.erro} />
      {tabelas.length > 1 ? (
        <Selecao rotulo="Filtrar por tipo" value={tabela} onChange={setTabela} vazio="Todos" opcoes={tabelas.map((t) => ({ valor: t, rotulo: rotuloTabela(t) }))} />
      ) : null}
      {registros.carregando ? <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Carregando…</p> : null}
      {registros.dados && lista.length === 0 ? <p className="px-4 py-10 text-center text-sm text-tertiary">Nada registrado ainda.</p> : null}
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {lista.map((r) => (
          <div key={r.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
              <strong>{descricao(r)}</strong>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">
                <bdi>{nomeDoAutor(r.autor, nomes)}</bdi> · {new Date(r.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Pagina>
  )
}
