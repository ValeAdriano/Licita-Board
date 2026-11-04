import { ChevronSelectorVertical } from '@untitledui/icons'
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
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={`Empresa: ${empresa?.empresa ?? ''}. Trocar empresa`}
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg bg-primary p-3 text-left shadow-xs ring-1 ring-primary outline-focus-ring ring-inset hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-tertiary">Empresa</span>
          <span className="truncate text-sm font-semibold text-primary">{empresa?.empresa}</span>
        </span>
        <ChevronSelectorVertical className="size-5 shrink-0 text-fg-quaternary" aria-hidden="true" />
      </button>
      <Modal aberto={aberto} titulo="Empresa" aoFechar={() => setAberto(false)}>
        <div className="flex flex-col gap-4" role="list">
          {vinculos.map((v) => (
            <button
              key={v.empresaId}
              type="button"
              role="listitem"
              className={`flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-left hover:bg-primary_hover ${v.empresaId === empresa?.empresaId ? 'bg-brand-primary' : ''}`}
              aria-current={v.empresaId === empresa?.empresaId}
              onClick={() => {
                escolherEmpresa(v.empresaId)
                setAberto(false)
              }}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
                <strong>{v.empresa}</strong>
                <span className="text-sm text-tertiary [overflow-wrap:anywhere]">{v.papel}</span>
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
