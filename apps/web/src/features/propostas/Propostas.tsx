import { useState } from 'react'
import { chamar } from '../../api/cliente'
import { Aviso, Botao, Campo, Etiqueta, Legenda, Selecao, Vazio } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useReautenticacao } from '../acesso/useReautenticacao'
import { dataHoraSP } from '../agenda/comum'
import { reais, semZeros } from '../precos/formato'
import { EnvioPortal, type EnvioResumo } from './EnvioPortal'

interface ItemSnap { numero_item: number; descricao: string; quantidade: string; valor_unitario: string; valor_total: string; marca: string | null; modelo: string | null; casas: number }
interface Divergencia { codigo: string; mensagem: string; bloqueia: boolean }
export interface Proposta {
  id: string; versao: number; tipo: string; status: 'rascunho' | 'conferencia' | 'aprovada' | 'final'; representanteId: string | null; representante: string | null
  validadeDias: number | null; prazoEntregaDias: number | null; garantiaMeses: number | null; condicoes: string | null; local: string | null; conteudo: ItemSnap[]
  total: string; totalExtenso: string | null; validacao: Divergencia[] | null; validadaEm: string | null; bloqueada: boolean; arquivoSha256: string | null; geradoEm: string | null
  temArquivo: boolean; temPdf: boolean; conferidoPor: string | null; conferidoEm: string | null; aprovadoPor: string | null; aprovadoEm: string | null
  ultimoEnvio?: EnvioResumo | null
}
export interface DadosPropostas { propostas: Proposta[]; representantes: { id: string; nome: string; tipo: string }[]; portal?: string | null }

const STATUS = { rascunho: ['Rascunho', 'cinza'], conferencia: ['Em conferência', 'aviso'], aprovada: ['Aprovada (gerando documento)', 'marca'], final: ['Final (bloqueada)', 'sucesso'] } as const

// Propostas do acompanhamento. O sistema valida e gera o documento; NUNCA envia ao portal: baixe o arquivo final e envie você mesmo,
// depois registre o comprovante. Custos e margens não entram na proposta.
export function Propostas({ empresaId, acompanhamentoId, d, podeCadastrar, podeEditar, podeAprovar, aoMudar }: { empresaId: string; acompanhamentoId: string; d: DadosPropostas; podeCadastrar: boolean; podeEditar: boolean; podeAprovar: boolean; aoMudar: () => void }) {
  const criar = useEnvio()
  const [f, setF] = useState({ rep: '', validade: '60', prazo: '', garantia: '', condicoes: '', local: '' })
  const n = (v: string) => (v.trim() === '' ? null : Number(v))
  return (
    <div className="flex flex-col gap-6">
      <Aviso tipo="atencao" texto="O sistema valida a proposta e gera o documento final, mas NUNCA envia ao portal: baixe o arquivo, envie você mesmo e registre o comprovante. Texto-padrão, modelo oficial do edital e papel timbrado ainda não estão ligados (EM DESENVOLVIMENTO)." />
      {podeCadastrar ? (
        <section className="flex flex-col gap-3 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-nova">
          <h2 id="h-nova">{d.propostas.length ? 'Nova proposta (outra versão)' : 'Criar proposta'}</h2>
          <Legenda>Só entram os itens com preço aprovado na formação de preços.</Legenda>
          <Aviso texto={criar.erro} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Selecao rotulo="Representante" value={f.rep} onChange={(v) => setF({ ...f, rep: v })} vazio="Escolha" opcoes={d.representantes.map((r) => ({ valor: r.id, rotulo: r.nome }))} />
            <Campo rotulo="Validade da proposta (dias)" type="number" min={1} value={f.validade} onChange={(v) => setF({ ...f, validade: v })} />
            <Campo rotulo="Prazo de entrega (dias)" type="number" min={1} value={f.prazo} onChange={(v) => setF({ ...f, prazo: v })} />
            <Campo rotulo="Garantia (meses)" type="number" min={1} value={f.garantia} onChange={(v) => setF({ ...f, garantia: v })} />
            <Campo rotulo="Local da assinatura" value={f.local} onChange={(v) => setF({ ...f, local: v })} maxLength={120} />
            <Campo rotulo="Condições comerciais" value={f.condicoes} onChange={(v) => setF({ ...f, condicoes: v })} maxLength={2000} />
          </div>
          <div><Botao carregando={criar.enviando} onClick={() => void criar.enviar(async () => { await chamar('POST', `/empresas/${empresaId}/acompanhamentos/${acompanhamentoId}/propostas`, { representanteId: f.rep || null, validadeDias: n(f.validade), prazoEntregaDias: n(f.prazo), garantiaMeses: n(f.garantia), condicoes: f.condicoes.trim() || null, local: f.local.trim() || null }); aoMudar() })}>Criar proposta</Botao></div>
        </section>
      ) : null}
      {d.propostas.length === 0 ? <Vazio>Nenhuma proposta criada ainda.</Vazio> : d.propostas.map((p) => <Cartao key={p.id} empresaId={empresaId} p={p} d={d} podeCadastrar={podeCadastrar} podeEditar={podeEditar} podeAprovar={podeAprovar} aoMudar={aoMudar} />)}
    </div>
  )
}

function Cartao({ empresaId, p, d, podeCadastrar, podeEditar, podeAprovar, aoMudar }: { empresaId: string; p: Proposta; d: DadosPropostas; podeCadastrar: boolean; podeEditar: boolean; podeAprovar: boolean; aoMudar: () => void }) {
  const { enviando, erro, enviar } = useEnvio()
  const [editando, setEditando] = useState(false)
  const [f, setF] = useState({ rep: p.representanteId ?? '', validade: String(p.validadeDias ?? ''), prazo: String(p.prazoEntregaDias ?? ''), garantia: String(p.garantiaMeses ?? ''), condicoes: p.condicoes ?? '', local: p.local ?? '' })
  const reaut = useReautenticacao('proposta_final', 'Aprovar a proposta gera o documento final com hash. Confirme com o código do autenticador.', [`Aprovar a proposta v${p.versao}`])
  const [rotulo, cor] = STATUS[p.status]
  const acao = (caminho: string, rotuloBotao: string, variante: 'primario' | 'secundario' | 'texto' = 'secundario', desabilitado = false) => (
    <Botao variante={variante} carregando={enviando} disabled={desabilitado} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/propostas/${p.id}/${caminho}`); aoMudar() })}>{rotuloBotao}</Botao>
  )
  const bloqueios = (p.validacao ?? []).filter((x) => x.bloqueia)
  const avisos = (p.validacao ?? []).filter((x) => !x.bloqueia)
  const n = (v: string) => (v.trim() === '' ? null : Number(v))
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-label={`Proposta versão ${p.versao}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 flex-1">Proposta · versão {p.versao}</h2>
        {p.ultimoEnvio ? <Etiqueta cor="sucesso">Enviada em {dataHoraSP(p.ultimoEnvio.enviadoEm)}</Etiqueta> : null}
        <Etiqueta cor={cor}>{rotulo}</Etiqueta>
      </div>
      <Aviso texto={erro} />
      <Legenda>Total {reais(p.total)}{p.totalExtenso ? ` (${p.totalExtenso})` : ''} · representante {p.representante ?? '—'} · validade {p.validadeDias ?? '—'} dias · entrega {p.prazoEntregaDias ?? '—'} dias · garantia {p.garantiaMeses ?? '—'} meses</Legenda>
      <ul className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl ring-1 ring-secondary">
        {p.conteudo.map((i) => (
          <li key={i.numero_item} className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]"><strong>Item {i.numero_item}</strong> · <bdi>{i.descricao}</bdi>{i.marca ? ` · ${i.marca} ${i.modelo ?? ''}` : ''}</span>
            <span className="text-secondary">{semZeros(i.quantidade)} × {reais(i.valor_unitario, i.casas)} = <strong className="text-primary">{reais(i.valor_total)}</strong></span>
          </li>
        ))}
      </ul>
      {p.validadaEm === null ? <Aviso tipo="info" texto="Validando… atualize em instantes." /> : null}
      {bloqueios.length > 0 ? (
        <div role="alert" className="flex flex-col gap-1 rounded-xl border border-error bg-error-primary p-3 text-sm text-error-primary">
          <strong>Divergências que bloqueiam o avanço ({bloqueios.length})</strong>
          <ul className="list-disc pl-5">{bloqueios.map((b) => <li key={b.codigo + b.mensagem} className="[overflow-wrap:anywhere]">{b.mensagem}</li>)}</ul>
        </div>
      ) : p.validadaEm ? <Etiqueta cor="sucesso">Validação sem divergência bloqueante</Etiqueta> : null}
      {avisos.length > 0 ? <ul className="list-disc pl-5 text-sm text-warning-primary">{avisos.map((b) => <li key={b.codigo + b.mensagem}>{b.mensagem}</li>)}</ul> : null}
      {p.conferidoPor ? <Legenda>Conferida por {p.conferidoPor} em {dataHoraSP(p.conferidoEm)}.</Legenda> : null}
      {p.aprovadoPor ? <Legenda>Aprovada por {p.aprovadoPor} em {dataHoraSP(p.aprovadoEm)}.</Legenda> : null}
      {p.arquivoSha256 ? <Legenda>Documento gerado em {dataHoraSP(p.geradoEm)} · SHA-256 {p.arquivoSha256}</Legenda> : null}
      {editando && p.status === 'rascunho' ? (
        <div className="grid grid-cols-1 gap-3 rounded-xl bg-secondary p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Selecao rotulo="Representante" value={f.rep} onChange={(v) => setF({ ...f, rep: v })} vazio="Escolha" opcoes={d.representantes.map((r) => ({ valor: r.id, rotulo: r.nome }))} />
          <Campo rotulo="Validade (dias)" type="number" min={1} value={f.validade} onChange={(v) => setF({ ...f, validade: v })} />
          <Campo rotulo="Prazo de entrega (dias)" type="number" min={1} value={f.prazo} onChange={(v) => setF({ ...f, prazo: v })} />
          <Campo rotulo="Garantia (meses)" type="number" min={1} value={f.garantia} onChange={(v) => setF({ ...f, garantia: v })} />
          <Campo rotulo="Local" value={f.local} onChange={(v) => setF({ ...f, local: v })} maxLength={120} />
          <Campo rotulo="Condições" value={f.condicoes} onChange={(v) => setF({ ...f, condicoes: v })} maxLength={2000} />
          <div><Botao carregando={enviando} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/propostas/${p.id}/dados`, { representanteId: f.rep || null, validadeDias: n(f.validade), prazoEntregaDias: n(f.prazo), garantiaMeses: n(f.garantia), condicoes: f.condicoes.trim() || null, local: f.local.trim() || null }); setEditando(false); aoMudar() })}>Salvar e revalidar</Botao></div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {p.status === 'rascunho' && podeCadastrar ? <Botao variante="secundario" onClick={() => setEditando(!editando)}>{editando ? 'Cancelar edição' : 'Editar dados'}</Botao> : null}
        {p.status === 'rascunho' && podeCadastrar ? acao('validar', 'Validar de novo') : null}
        {p.status === 'rascunho' && podeEditar ? acao('conferir', 'Enviar para conferência', 'primario', p.bloqueada || p.validadaEm === null) : null}
        {p.status === 'conferencia' && podeAprovar ? <><Botao carregando={enviando} disabled={p.bloqueada} onClick={() => void enviar(async () => { await reaut.executar(async (stepUp) => { await chamar('POST', `/empresas/${empresaId}/propostas/${p.id}/aprovar`, { stepUp }); aoMudar() }) })}>Aprovar e gerar documento final</Botao>{reaut.modal}</> : null}
        {(p.status === 'conferencia' || p.status === 'aprovada') && podeEditar ? acao('devolver', 'Devolver a rascunho', 'texto') : null}
        {p.status === 'aprovada' ? <Legenda>Gerando o documento… atualize em instantes.</Legenda> : null}
        {p.status === 'final' && p.temArquivo ? <Botao carregando={enviando} onClick={() => void enviar(async () => { const r = await chamar<{ url: string }>('POST', `/empresas/${empresaId}/propostas/${p.id}/download`, { formato: 'docx' }); window.location.assign(r.url) })}>Baixar Word (.docx)</Botao> : null}
        {p.status === 'final' && p.temPdf ? <Botao carregando={enviando} onClick={() => void enviar(async () => { const r = await chamar<{ url: string }>('POST', `/empresas/${empresaId}/propostas/${p.id}/download`, { formato: 'pdf' }); window.location.assign(r.url) })}>Baixar PDF</Botao> : null}
        {p.status === 'final' && !p.temPdf ? <Botao variante="secundario" carregando={enviando} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/propostas/${p.id}/pdf`); aoMudar() })}>Gerar PDF</Botao> : null}
        {p.status === 'final' && podeCadastrar ? acao('nova-versao', 'Criar nova versão (para alterar)') : null}
      </div>
      {p.status === 'final' ? (
        <EnvioPortal
          empresaId={empresaId}
          propostaId={p.id}
          versao={p.versao}
          portalPadrao={d.portal ?? null}
          representantePadrao={p.representanteId}
          representantes={d.representantes}
          podeAprovar={podeAprovar}
          aoMudar={aoMudar}
        />
      ) : null}
    </section>
  )
}
