import { useEffect, useRef, useState } from 'react'
import { chamar } from '../../api/cliente'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useGet } from '../acesso/useGet'
import { dataHoraSP } from '../agenda/comum'
import { AreaTexto, Aviso, Botao, Cartao, Legenda } from '../../ui'

interface Pedido { id: string; status: 'pendente' | 'concluida' | 'falhou' | 'desligada'; modelo: string | null; fontesUsadas: number; citacoesForaDaBase: number; erro: string | null; pedidoEm: string; concluidaEm: string | null }

// Minuta pela IA (Fase 10): a IA só ELABORA o rascunho a partir da base jurídica VERIFICADA e do texto do edital. Quem decide, revisa e
// aprova é o jurídico; a conferência de citações do módulo continua bloqueando qualquer citação fora da base.
export function MinutaIa({ empresaId, pecaId, temMinuta, aoConcluir }: { empresaId: string; pecaId: string; temMinuta: boolean; aoConcluir: () => void }) {
  const base = `/empresas/${empresaId}/juridico/pecas/${pecaId}/minuta-ia`
  const lista = useGet<Pedido[]>(base)
  const { enviando, erro, enviar } = useEnvio()
  const [instrucao, setInstrucao] = useState('')
  const ultimo = lista.dados?.[0]
  const pendente = ultimo?.status === 'pendente'
  const visto = useRef<string | null>(null)
  const { recarregar } = lista
  useEffect(() => {
    if (!pendente) return
    const t = setInterval(recarregar, 4000)
    return () => clearInterval(t)
  }, [pendente, recarregar])
  useEffect(() => {
    if (ultimo && ultimo.status !== 'pendente' && visto.current === ultimo.id) {
      visto.current = null
      aoConcluir() // o rascunho já foi gravado: recarrega a peça
    }
    if (pendente && ultimo) visto.current = ultimo.id
  }, [ultimo, pendente, aoConcluir])
  const pedir = () => {
    if (temMinuta && !window.confirm('A sugestão da IA SUBSTITUI o texto atual da minuta. Continuar?')) return
    void enviar(async () => { await chamar('POST', base, { instrucao: instrucao.trim() || null }); setInstrucao(''); recarregar() })
  }
  return (
    <Cartao>
      <h2>Minuta pela IA <span className="text-sm font-normal text-tertiary">(EM DESENVOLVIMENTO)</span></h2>
      <Legenda>A IA escreve um rascunho usando só as fontes da base jurídica verificada e o texto do edital. Ela só sugere: você revisa, edita e aprova. Citação fora da base verificada bloqueia a peça. Nenhum dado da sua empresa (custos, margens, CNPJ) é enviado.</Legenda>
      <Aviso texto={erro} />
      <AreaTexto rotulo="Orientação para a IA (opcional)" value={instrucao} onChange={setInstrucao} rows={3} maxLength={3000} disabled={pendente} />
      <div className="flex flex-wrap items-center gap-3">
        <Botao variante="secundario" carregando={enviando || pendente} disabled={pendente} onClick={pedir}>{pendente ? 'A IA está redigindo…' : 'Sugerir minuta com IA'}</Botao>
        {ultimo && !pendente ? <Legenda>Último pedido: {dataHoraSP(ultimo.pedidoEm)}</Legenda> : null}
      </div>
      {ultimo?.status === 'desligada' ? <Aviso tipo="atencao" texto="A IA não está configurada para esta empresa. Cadastre a chave em Cadastros → IA." /> : null}
      {ultimo?.status === 'falhou' ? <Aviso texto={`A IA não conseguiu redigir: ${ultimo.erro ?? 'erro desconhecido'}.`} /> : null}
      {ultimo?.status === 'concluida' ? <Aviso tipo="info" texto={`Rascunho gerado (${ultimo.modelo ?? 'IA'}) com ${ultimo.fontesUsadas} fonte(s) verificada(s) disponíveis${ultimo.citacoesForaDaBase ? `; ${ultimo.citacoesForaDaBase} citação(ões) FORA da base foram detectadas e bloqueiam a peça até você corrigir` : ''}. Revise tudo antes de enviar.`} /> : null}
    </Cartao>
  )
}
