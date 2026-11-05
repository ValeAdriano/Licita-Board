import { chamar } from '../../api/cliente'
import { Botao, Cartao, Etiqueta, Legenda } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useGet } from '../acesso/useGet'

interface TeseDaPeca { id: string; titulo: string; texto: string; usada: boolean }

// Teses aprovadas do mesmo tipo da peça: "Inserir no texto" acrescenta o argumento ao fim da minuta (ainda não salva) e registra o uso.
export function TesesDaPeca({ empresaId, pecaId, aoInserir }: { empresaId: string; pecaId: string; aoInserir: (texto: string) => void }) {
  const lista = useGet<TeseDaPeca[]>(`/empresas/${empresaId}/juridico/pecas/${pecaId}/teses`)
  const { enviando, erro, enviar } = useEnvio()
  const teses = lista.dados ?? []
  if (teses.length === 0) return null
  return (
    <Cartao><h2>Teses aprovadas para este tipo de peça</h2>
      <Legenda>Inserir acrescenta o argumento ao fim da minuta e registra o uso (para os indicadores). Depois, salve e confira as citações. {erro}</Legenda>
      {teses.map((t) => (
        <div key={t.id} className="flex flex-col gap-1 border-t border-secondary pt-2">
          <span className="flex flex-wrap items-center gap-2"><strong className="[overflow-wrap:anywhere]"><bdi>{t.titulo}</bdi></strong>{t.usada ? <Etiqueta cor="sucesso">Já usada nesta peça</Etiqueta> : null}</span>
          <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]"><bdi>{t.texto}</bdi></p>
          <div><Botao variante="secundario" carregando={enviando} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/juridico/pecas/${pecaId}/teses/${t.id}`); aoInserir(t.texto); lista.recarregar() })}>Inserir no texto</Botao></div>
        </div>
      ))}
    </Cartao>
  )
}
