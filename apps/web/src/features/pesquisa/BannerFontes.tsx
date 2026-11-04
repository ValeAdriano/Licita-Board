import { Aviso } from '../../ui'
import { useGet } from '../acesso/useGet'
import { problemas, quando, type FonteEstado } from './formato'

// Estado das fontes, sempre visível junto das oportunidades: lista vazia nunca aparece sozinha.
export function BannerFontes() {
  const { dados, erro } = useGet<FonteEstado[]>('/pesquisa/estado')
  if (erro) return <Aviso texto={`Não foi possível conferir o estado das fontes: ${erro}. Oportunidades podem estar faltando.`} />
  if (!dados) return null
  const ativas = dados.filter((f) => f.ativa)
  if (ativas.length === 0) return <Aviso tipo="info" texto="A pesquisa automática ainda não está ligada (EM DESENVOLVIMENTO). Use a importação manual de edital." />
  const ruins = problemas(dados)
  if (ruins.length > 0) {
    return <Aviso texto={`Fonte com problema ou sem busca recente: ${ruins.join(', ')}. Oportunidades novas podem estar faltando.`} />
  }
  const ultimo = ativas.map((f) => f.ultimoSucessoEm).filter((x): x is string => !!x).sort().at(-1)
  return <Aviso tipo="info" texto={`Última busca bem-sucedida: ${quando(ultimo)}.`} />
}
