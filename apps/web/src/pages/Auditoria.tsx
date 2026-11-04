import { useMemo, useState } from 'react'
import { useAcesso, type Vinculo } from '../features/acesso/contexto'
import { descricao, nomeDoAutor, rotuloTabela, type Registro } from '../features/acesso/auditoria/rotulos'
import type { Membro } from '../features/acesso/equipe/tipos'
import { useGet } from '../features/acesso/useGet'
import { Aviso } from '../ui'

// Auditoria da empresa (Prompt 1.4, RF-01.2): quem fez o quê e quando. Só leitura; o registro é
// imutável no banco. A API devolve os 200 mais recentes e só para quem tem auditoria/visualizar.
export default function Auditoria() {
  const { empresa } = useAcesso()
  if (!empresa) return <p className="vazio">Selecione uma empresa.</p>
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

  if (!podeVer) return <p className="vazio">Você não tem permissão para ver a auditoria de {empresa.empresa}.</p>
  return (
    <div className="conteudo__miolo conteudo__miolo--largo entra">
      <div>
        <h1>Auditoria</h1>
        <p className="legenda">{empresa.empresa} · as 200 ações mais recentes</p>
      </div>
      <Aviso texto={registros.erro} />
      {tabelas.length > 1 ? (
        <label className="campo">
          <span className="campo__rotulo">Filtrar por tipo</span>
          <select className="campo__entrada" value={tabela} onChange={(e) => setTabela(e.target.value)}>
            <option value="">Todos</option>
            {tabelas.map((t) => (
              <option key={t} value={t}>
                {rotuloTabela(t)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {registros.carregando ? <p className="legenda">Carregando…</p> : null}
      {registros.dados && lista.length === 0 ? <p className="vazio">Nada registrado ainda.</p> : null}
      <div className="lista">
        {lista.map((r) => (
          <div key={r.id} className="lista__item" style={{ cursor: 'default' }}>
            <span className="lista__texto">
              <strong>{descricao(r)}</strong>
              <span className="legenda">
                <bdi>{nomeDoAutor(r.autor, nomes)}</bdi> · {new Date(r.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
