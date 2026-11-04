import { useState } from 'react'
import { chamar, ErroApi } from '../../../api/cliente'
import { Aviso, Botao, Etiqueta } from '../../../ui'
import { cnpjLegivel } from '../cnpj'
import { useAcesso } from '../contexto'
import { StepUpModal } from '../equipe/StepUpModal'
import { useGet } from '../useGet'
import { podeDecidir, rotuloStatus, type PedidoExclusao } from './tipos'

// Pedidos de exclusão definitiva. Quem pediu não decide o próprio pedido (o banco também recusa).
export function Exclusoes() {
  const { usuario, recarregar } = useAcesso()
  const pedidos = useGet<PedidoExclusao[]>('/exclusoes')
  const [decisao, setDecisao] = useState<{ pedido: PedidoExclusao; aprovar: boolean } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function decidir(stepUp: string) {
    if (!decisao) return
    try {
      await chamar('POST', `/exclusoes/${decisao.pedido.id}/decidir`, { aprovar: decisao.aprovar, stepUp })
    } catch (e) {
      setDecisao(null)
      setErro(`${e instanceof ErroApi ? e.message : 'Não foi possível registrar a decisão.'} O código já foi usado: aguarde o próximo para tentar de novo.`)
      return
    }
    setDecisao(null)
    pedidos.recarregar()
    await recarregar()
  }

  const nome = (p: PedidoExclusao) => p.resumo?.razao_social ?? 'Empresa'
  const cnpj = (p: PedidoExclusao) => (p.resumo?.cnpj ? `CNPJ ${cnpjLegivel(p.resumo.cnpj)}` : '')

  return (
    <div className="flex flex-col gap-6">
      <Aviso texto={erro ?? pedidos.erro} />
      {pedidos.carregando ? <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Carregando…</p> : null}
      {pedidos.dados?.length === 0 ? <p className="px-4 py-10 text-center text-sm text-tertiary">Nenhum pedido de exclusão.</p> : null}
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {pedidos.dados?.map((p) => (
          <div key={p.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left flex-wrap items-start">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
              <strong>
                <bdi>{nome(p)}</bdi>
              </strong>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">{cnpj(p)}</span>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">Motivo: {p.motivo}</span>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">
                Pedido em {new Date(p.solicitadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                {p.solicitadoPor === usuario?.id ? ' por você' : ''}
              </span>
            </span>
            <Etiqueta>{rotuloStatus[p.status]}</Etiqueta>
            {podeDecidir(p, usuario?.id) ? (
              <span className="ml-auto flex flex-wrap gap-2">
                <Botao variante="perigo" onClick={() => setDecisao({ pedido: p, aprovar: true })}>
                  Aprovar e excluir
                </Botao>
                <Botao variante="secundario" onClick={() => setDecisao({ pedido: p, aprovar: false })}>
                  Rejeitar
                </Botao>
              </span>
            ) : p.status === 'pendente' && p.solicitadoPor === usuario?.id ? (
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">Outro SUPERADMIN precisa decidir.</span>
            ) : null}
          </div>
        ))}
      </div>
      <StepUpModal
        aberto={decisao !== null}
        escopo="exclusao_definitiva"
        descricao={
          decisao?.aprovar
            ? 'Aprovar apaga a empresa e tudo que é dela, sem volta. Confira o resumo e digite o código do autenticador.'
            : 'Rejeitar encerra o pedido sem apagar nada. Confira o resumo e digite o código do autenticador.'
        }
        resumo={decisao ? [`${decisao.aprovar ? 'Aprovar e excluir' : 'Rejeitar'}: ${nome(decisao.pedido)}`, cnpj(decisao.pedido), `Motivo do pedido: ${decisao.pedido.motivo}`].filter(Boolean) : []}
        aoConfirmar={decidir}
        aoCancelar={() => setDecisao(null)}
      />
    </div>
  )
}
