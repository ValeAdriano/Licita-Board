import { useState } from 'react'
import { chamar, ErroApi } from '../../../api/cliente'
import { Aviso, Botao } from '../../../ui'
import { cnpjLegivel } from '../cnpj'
import { useAcesso } from '../contexto'
import { rotuloPapel } from '../matriz'
import { useGet } from '../useGet'

export interface ConviteRecebido {
  id: string
  empresa: string
  cnpj: string
  convidado_por: string | null
  papel: string
  permissoes: string[]
  expira_em: string
}

// Convites que a própria conta recebeu (a API só devolve os válidos e os cobertos pelo autor). O nome
// da empresa é texto livre de terceiro (T3.1c): antes de aceitar, a pessoa vê CNPJ, quem convidou, o
// papel e as permissões. Aceitar liga o vínculo e atualiza o app.
export function ConvitesRecebidos() {
  const { recarregar } = useAcesso()
  const { dados, recarregar: recarregarLista } = useGet<ConviteRecebido[]>('/me/convites')
  const [erro, setErro] = useState<string | null>(null)
  const [revisando, setRevisando] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function aceitar(id: string) {
    setEnviando(true)
    setErro(null)
    try {
      await chamar('POST', `/me/convites/${id}/aceitar`)
      setRevisando(null)
      await recarregar().catch(() => {})
      recarregarLista()
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível aceitar o convite.')
    } finally {
      setEnviando(false)
    }
  }

  if (!dados || dados.length === 0) return null
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-primary p-4 shadow-xs ring-2 ring-brand md:p-6" aria-label="Convites recebidos">
      <h2>Convites recebidos</h2>
      {dados.map((c) => (
        <div key={c.id} className="flex flex-col gap-1">
          <strong>
            <bdi>{c.empresa}</bdi>
          </strong>
          <span className="text-sm text-tertiary [overflow-wrap:anywhere]">CNPJ {cnpjLegivel(c.cnpj)}</span>
          <span className="text-sm text-tertiary [overflow-wrap:anywhere]">
            Convidado por <bdi>{c.convidado_por ?? 'usuário desconhecido'}</bdi>
          </span>
          <span className="text-sm text-tertiary [overflow-wrap:anywhere]">
            {rotuloPapel(c.papel)} · {c.permissoes.length} permissão(ões) · vence em {new Date(c.expira_em).toLocaleDateString('pt-BR')}
          </span>
          {revisando === c.id ? (
            <>
              <Aviso tipo="atencao" texto="Confira se a empresa e quem convidou são os esperados. Ao aceitar, você terá acesso a esta empresa com as permissões acima." />
              <Botao onClick={() => void aceitar(c.id)} carregando={enviando}>
                Confirmar e aceitar
              </Botao>
              <Botao variante="texto" onClick={() => setRevisando(null)}>
                Voltar
              </Botao>
            </>
          ) : (
            <div>
              <Botao onClick={() => setRevisando(c.id)}>Revisar convite</Botao>
            </div>
          )}
        </div>
      ))}
      <Aviso texto={erro} />
    </section>
  )
}

export { cnpjLegivel }
