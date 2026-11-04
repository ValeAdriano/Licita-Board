import type { ReactNode } from 'react'
import { Badge } from '@/components/base/badges/badges'

type Cor = 'cinza' | 'aviso' | 'sucesso' | 'erro' | 'marca'
const COR = { cinza: 'gray', aviso: 'warning', sucesso: 'success', erro: 'error', marca: 'brand' } as const

// Selo (badge) do Untitled UI para estado e classificação.
export function Etiqueta({ cor = 'cinza', children }: { cor?: Cor; children: ReactNode }) {
  return (
    <Badge type="pill-color" size="md" color={COR[cor]}>
      {children}
    </Badge>
  )
}
