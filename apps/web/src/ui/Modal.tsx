import { useId, type ReactNode } from 'react'
import { Dialog, Modal as ModalUui, ModalOverlay } from '@/components/application/modals/modal'

// Diálogo modal (Untitled UI + react-aria): foco preso, Esc fecha, foco volta a quem abriu.
export function Modal({ aberto, titulo, aoFechar, children }: { aberto: boolean; titulo: string; aoFechar: () => void; children: ReactNode }) {
  const idTitulo = useId()
  return (
    <ModalOverlay isOpen={aberto} onOpenChange={(v) => !v && aoFechar()} isDismissable>
      <ModalUui className="max-w-md">
        <Dialog aria-labelledby={idTitulo}>
          <div className="flex w-full flex-col gap-4 p-6">
            <h2 id={idTitulo} className="text-lg font-semibold text-primary">
              {titulo}
            </h2>
            {children}
          </div>
        </Dialog>
      </ModalUui>
    </ModalOverlay>
  )
}
