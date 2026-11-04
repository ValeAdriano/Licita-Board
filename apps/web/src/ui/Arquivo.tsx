import { FileTrigger } from 'react-aria-components'
import { Botao } from './Botao'
import { Legenda } from './Layout'

// Escolha de arquivo: botão do Untitled UI + react-aria (`FileTrigger`); mostra o nome escolhido.
export function Arquivo({ rotulo, aceita, arquivo, aoEscolher }: { rotulo: string; aceita: string[]; arquivo: File | null; aoEscolher: (f: File | null) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-secondary">{rotulo}</span>
      <div className="flex flex-wrap items-center gap-3">
        <FileTrigger acceptedFileTypes={aceita} onSelect={(lista) => aoEscolher(lista?.[0] ?? null)}>
          <Botao variante="secundario">Escolher arquivo</Botao>
        </FileTrigger>
        <Legenda>{arquivo ? arquivo.name : 'Nenhum arquivo escolhido'}</Legenda>
      </div>
    </div>
  )
}
