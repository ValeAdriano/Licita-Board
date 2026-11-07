import { useSyncExternalStore } from 'react'
import { Selecao } from '../ui/Selecao'
import { definirTema, obterTema, observarTema, type Tema } from './tema'

export function SeletorTema() {
  const tema = useSyncExternalStore(observarTema, obterTema)
  return <Selecao rotulo="Tema" value={tema} onChange={(valor) => definirTema(valor as Tema)} opcoes={[
    { valor: 'claro', rotulo: 'Claro' },
    { valor: 'escuro', rotulo: 'Escuro' },
    { valor: 'sistema', rotulo: 'Sistema' },
  ]} />
}
