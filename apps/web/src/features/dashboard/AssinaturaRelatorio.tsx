import { chamar } from '../../api/cliente'
import { Aviso, Interruptor, Legenda } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useGet } from '../acesso/useGet'

// Relatório diário por e-mail (12.2): desligado por padrão; cada pessoa liga o seu, por empresa. Chega depois das 7h (Brasília), só com o que a
// pessoa pode ver, e sem valores financeiros.
export function AssinaturaRelatorio({ empresaId }: { empresaId: string }) {
  const estado = useGet<{ ativo: boolean }>(`/empresas/${empresaId}/relatorio-diario`)
  const { enviando, erro, enviar } = useEnvio()
  if (!estado.dados) return null
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-secondary p-4">
      <Aviso texto={erro ?? estado.erro} />
      <Interruptor rotulo="Receber o relatório diário por e-mail" marcado={estado.dados.ativo} desabilitado={enviando}
        aoMudar={(v) => void enviar(async () => { await chamar('PUT', `/empresas/${empresaId}/relatorio-diario`, { ativo: v }); estado.recarregar() })} />
      <Legenda>Resumo das 7h com oportunidades, disputas e prazos dos próximos 7 dias, pendências e alertas de contratos, só dos módulos que você pode ver. (EM DESENVOLVIMENTO)</Legenda>
    </div>
  )
}
