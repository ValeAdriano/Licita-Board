import { useState } from 'react'
import { useNavigate } from 'react-router'
import { chamar } from '../../api/cliente'
import { Aviso, Botao, Campo, Cartao, Etiqueta, Legenda, Selecao, Vazio } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'
import { dataHoraSP, type Acompanhado } from '../agenda/comum'

interface Sugestao { id: string; acompanhamentoId: string; tipo: string; titulo: string; trecho: string | null; pagina: number | null; duvida: string; impacto: string | null; pedido: string | null; fundamento: string | null; fundamentoNaBase: boolean; viabilidade: string | null; viabilidadeJustificativa: string | null; prazoLegal: string | null; status: string; justificativaDescarte: string | null; pecaId: string | null; numeroEdital: string | null; orgao: string | null }
interface Execucao { acompanhamentoId: string; status: string; erro: string | null; concluidaEm: string | null; criadas: number; descartadas: number }
const VIAB: Record<string, [string, 'sucesso' | 'aviso' | 'cinza']> = { alta: ['Viabilidade alta', 'sucesso'], media: ['Viabilidade média', 'aviso'], baixa: ['Viabilidade baixa', 'cinza'] }

// Sugestões de esclarecimento e impugnação a partir do edital (10.2/10.3). A IA só sugere; aceitar abre a peça em triagem, descartar exige justificativa.
export function Sugestoes({ empresaId }: { empresaId: string }) {
  const { pode } = useAcesso()
  const dados = useGet<{ sugestoes: Sugestao[]; execucoes: Execucao[] }>(`/empresas/${empresaId}/juridico/sugestoes`)
  const acomps = useGet<Acompanhado[]>(pode('agenda', 'visualizar') ? `/empresas/${empresaId}/agenda/acompanhamentos` : null)
  const [acomp, setAcomp] = useState('')
  const { enviando, erro, enviar } = useEnvio()
  const ex = (dados.dados?.execucoes ?? []).find((e) => e.acompanhamentoId === acomp)
  const lista = dados.dados?.sugestoes ?? []
  return (
    <div className="flex flex-col gap-4">
      <Aviso texto={erro ?? dados.erro} />
      <Legenda>A IA lê o texto do edital e sugere pedidos de esclarecimento e impugnações, sempre com o trecho literal. Fundamento só vem da base jurídica verificada; sem ele, a viabilidade nunca passa de baixa. Prazo vencido aparece como intempestivo. Você decide. (EM DESENVOLVIMENTO)</Legenda>
      {pode('juridico', 'elaborar_peca') ? (
        <div className="grid grid-cols-1 gap-3 rounded-xl bg-secondary p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Selecao rotulo="Edital acompanhado" value={acomp} onChange={setAcomp} vazio="Escolha" opcoes={(acomps.dados ?? []).map((a) => ({ valor: a.id, rotulo: `${a.orgao}${a.numeroEdital ? ` · nº ${a.numeroEdital}` : ''}`.slice(0, 80) }))} />
          <div className="flex items-end gap-3"><Botao carregando={enviando || ex?.status === 'pendente'} disabled={!acomp || ex?.status === 'pendente'} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/juridico/acompanhamentos/${acomp}/sugestoes`); dados.recarregar() })}>{ex?.status === 'pendente' ? 'A IA está lendo o edital…' : 'Buscar sugestões com IA'}</Botao>{ex?.status === 'pendente' ? <Botao variante="texto" onClick={dados.recarregar}>Atualizar</Botao> : null}</div>
          {ex?.status === 'desligada' ? <Aviso tipo="atencao" texto="A IA não está configurada: cadastre a chave em Cadastros → IA." /> : null}
          {ex?.status === 'falhou' ? <Aviso texto={`A busca falhou: ${ex.erro ?? 'erro desconhecido'}.`} /> : null}
          {ex?.status === 'concluida' ? <Aviso tipo="info" texto={`Busca concluída: ${ex.criadas} sugestão(ões); ${ex.descartadas} descartada(s) por não terem trecho literal do edital.`} /> : null}
        </div>
      ) : null}
      {lista.length === 0 && !dados.carregando ? <Vazio>Nenhuma sugestão ainda. Escolha um edital e peça à IA.</Vazio> : null}
      {lista.map((s) => <Item key={s.id + s.status} s={s} empresaId={empresaId} pode={pode('juridico', 'elaborar_peca')} enviando={enviando} enviar={enviar} recarregar={dados.recarregar} />)}
    </div>
  )
}

function Item({ s, empresaId, pode, enviando, enviar, recarregar }: { s: Sugestao; empresaId: string; pode: boolean; enviando: boolean; enviar: (fn: () => Promise<void>) => Promise<unknown>; recarregar: () => void }) {
  const navegar = useNavigate()
  const [just, setJust] = useState('')
  const [rotulo, cor] = VIAB[s.viabilidade ?? ''] ?? ['', 'cinza' as const]
  const base = `/empresas/${empresaId}/juridico/sugestoes/${s.id}`
  return (
    <Cartao>
      <span className="flex flex-wrap items-center gap-2"><strong className="[overflow-wrap:anywhere]"><bdi>{s.titulo}</bdi></strong><Etiqueta cor="cinza">{s.tipo === 'impugnacao' ? 'Impugnação' : 'Esclarecimento'}</Etiqueta>
        {s.viabilidade ? <Etiqueta cor={cor}>{rotulo}</Etiqueta> : null}
        {s.status === 'intempestiva' ? <Etiqueta cor="erro">Intempestiva: prazo legal vencido</Etiqueta> : null}
        {s.status === 'aceita' ? <Etiqueta cor="sucesso">Aceita</Etiqueta> : null}{s.status === 'descartada' ? <Etiqueta cor="cinza">Descartada</Etiqueta> : null}</span>
      <Legenda>{s.orgao ?? '—'}{s.numeroEdital ? ` · nº ${s.numeroEdital}` : ''}{s.prazoLegal ? ` · prazo legal ${dataHoraSP(s.prazoLegal)}` : ' · prazo ainda não calculado na agenda: confira o edital'}</Legenda>
      {s.trecho ? <Legenda>Edital{s.pagina ? ` (página ${s.pagina})` : ''}: “<bdi>{s.trecho}</bdi>”</Legenda> : null}
      <p className="text-sm [overflow-wrap:anywhere]"><strong>Dúvida/ilegalidade:</strong> <bdi>{s.duvida}</bdi>{s.impacto ? <> · <strong>Impacto:</strong> <bdi>{s.impacto}</bdi></> : null}{s.pedido ? <> · <strong>Pedido:</strong> <bdi>{s.pedido}</bdi></> : null}</p>
      <Legenda>{s.fundamento ? `Fundamento (base verificada): ${s.fundamento}` : 'Sem fundamento na base jurídica verificada: A CONFIRMAR.'}{s.viabilidadeJustificativa ? ` · ${s.viabilidadeJustificativa}` : ''}</Legenda>
      {s.justificativaDescarte ? <Legenda>Descartada: <bdi>{s.justificativaDescarte}</bdi></Legenda> : null}
      {s.pecaId ? <Botao variante="texto" onClick={() => navegar(`/juridico/pecas/${s.pecaId}`)}>Abrir a peça →</Botao> : null}
      {pode && ['nova', 'intempestiva'].includes(s.status) ? (
        <div className="flex flex-wrap items-end gap-3">
          {s.status === 'nova' ? <Botao carregando={enviando} onClick={() => void enviar(async () => { const r = await chamar<{ pecaId: string }>('POST', `${base}/aceitar`); navegar(`/juridico/pecas/${r.pecaId}`) })}>Aceitar e abrir a peça</Botao> : null}
          <div className="min-w-64 flex-1"><Campo rotulo="Descartar (justificativa obrigatória)" value={just} onChange={setJust} maxLength={1000} /></div>
          <Botao variante="texto" carregando={enviando} disabled={just.trim().length < 10} onClick={() => void enviar(async () => { await chamar('POST', `${base}/descartar`, { justificativa: just.trim() }); recarregar() })}>Descartar</Botao>
        </div>
      ) : null}
    </Cartao>
  )
}
