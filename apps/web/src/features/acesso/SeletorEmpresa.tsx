import { useState } from 'react'
import { Botao, Modal } from '../../ui'
import { useAcesso } from './contexto'

// Seletor de empresa do cabeçalho: só as empresas com vínculo ativo (o que /me devolve).
export function SeletorEmpresa() {
  const { vinculos, empresa, escolherEmpresa } = useAcesso()
  const [aberto, setAberto] = useState(false)
  if (vinculos.length === 0) return null
  return (
    <>
      <Botao variante="texto" onClick={() => setAberto(true)} aria-label={`Empresa: ${empresa?.empresa ?? ''}. Trocar empresa`}>
        <span className="topo__empresa">{empresa?.empresa} ▾</span>
      </Botao>
      <Modal aberto={aberto} titulo="Empresa" aoFechar={() => setAberto(false)}>
        <div className="pilha" role="list">
          {vinculos.map((v) => (
            <button
              key={v.empresaId}
              type="button"
              role="listitem"
              className="lista__item"
              aria-current={v.empresaId === empresa?.empresaId}
              style={v.empresaId === empresa?.empresaId ? { background: 'var(--acento-fraco)', borderRadius: 'var(--raio-m)' } : { borderRadius: 'var(--raio-m)' }}
              onClick={() => {
                escolherEmpresa(v.empresaId)
                setAberto(false)
              }}
            >
              <span className="lista__texto">
                <strong>{v.empresa}</strong>
                <span className="legenda">{v.papel}</span>
              </span>
            </button>
          ))}
        </div>
        <Botao variante="secundario" onClick={() => setAberto(false)}>
          Fechar
        </Botao>
      </Modal>
    </>
  )
}
