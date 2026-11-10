import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { chamar } from '../api/cliente'
import { useEnvio } from '../features/acesso/conta/useEnvio'
import { useAcesso } from '../features/acesso/contexto'
import { useGet } from '../features/acesso/useGet'
import { Anexos } from '../features/contratos/Anexos'
import { dia, ETAPAS, TIPO_EVENTO_CONTRATO, type Detalhe } from '../features/contratos/tipos'
import { ehDecimal, paraDecimal, reais, semZeros } from '../features/precos/formato'
import { Abas, Aviso, Botao, CabecalhoPagina, Campo, Cartao, Etiqueta, Legenda, Pagina, Selecao, Vazio } from '../ui'

type Aba = 'itens' | 'empenhos' | 'financeiro' | 'historico' | 'anexos'

export default function ContratoPagina() {
  const { id } = useParams()
  const { empresa, pode } = useAcesso()
  const empresaId = empresa?.empresaId ?? null
  const det = useGet<Detalhe>(empresaId && id ? `/empresas/${empresaId}/contratos/${id}` : null)
  const [aba, setAba] = useState<Aba>('itens')
  const { enviando, erro, enviar } = useEnvio()
  if (!empresaId || !id) return <p className="py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  if (det.erro) return <p className="py-10 text-center text-sm text-tertiary">Contrato não encontrado ou sem permissão.</p>
  if (!det.dados) return <p className="text-sm text-tertiary">Carregando…</p>
  const d = det.dados
  const c = d.contrato
  const base = `/empresas/${empresaId}`
  const editar = pode('contratos', 'editar') && c.status === 'ativo'
  const fin = pode('financeiro', 'editar')
  const abas = [{ id: 'itens', rotulo: 'Itens e saldos' }, { id: 'empenhos', rotulo: 'Empenhos e entregas' }, ...(d.faturas ? [{ id: 'financeiro', rotulo: 'Financeiro' }] : []), { id: 'historico', rotulo: 'Histórico' }, { id: 'anexos', rotulo: 'Anexos e pedidos' }]
  return (
    <Pagina larga>
      <Link to="/contratos">← Contratos</Link>
      <CabecalhoPagina titulo={`${c.tipo === 'ata' ? 'Ata' : 'Contrato'} ${c.numero}`} subtitulo={`${c.orgao} · vigência ${dia(c.vigenciaInicio)} a ${dia(c.vigenciaFim)} · ${reais(c.valorTotal)}`} acoes={<><Etiqueta cor={c.status === 'ativo' ? 'sucesso' : 'cinza'}>{c.status}</Etiqueta>{editar ? <Botao variante="secundario" carregando={enviando} onClick={() => void enviar(async () => { await chamar('POST', `${base}/contratos/${id}/encerrar`, { status: 'encerrado' }); det.recarregar() })}>Encerrar contrato</Botao> : null}</>} />
      <Aviso texto={erro} />
      {d.alertas.map((a) => <Aviso key={a.mensagem} tipo={a.nivel === 'vencido' ? 'erro' : 'atencao'} texto={a.mensagem} />)}
      <Legenda>Objeto: <bdi>{c.objeto}</bdi>{c.gestorOrgao ? ` · gestor ${c.gestorOrgao}` : ''}{c.fiscalOrgao ? ` · fiscal ${c.fiscalOrgao}` : ''}{c.garantiaValor ? ` · garantia ${reais(c.garantiaValor)}${c.garantiaAte ? ` até ${dia(c.garantiaAte)}` : ''}` : ''}</Legenda>
      <Abas rotulo="Contrato" ativa={aba} aoMudar={(a) => setAba(a as Aba)} abas={abas} />
      {aba === 'itens' ? <Itens empresaId={empresaId} id={id} d={d} editar={editar} recarregar={det.recarregar} /> : null}
      {aba === 'empenhos' ? <Empenhos empresaId={empresaId} id={id} d={d} editar={editar} recarregar={det.recarregar} /> : null}
      {aba === 'financeiro' && d.faturas ? <Financeiro empresaId={empresaId} id={id} d={d} editar={fin && c.status === 'ativo'} recarregar={det.recarregar} /> : null}
      {aba === 'anexos' ? <Anexos empresaId={empresaId} id={id} d={d} editar={editar} /> : null}
      {aba === 'historico' ? <Historico empresaId={empresaId} id={id} d={d} editar={editar} recarregar={det.recarregar} /> : null}
    </Pagina>
  )
}

interface P { empresaId: string; id: string; d: Detalhe; editar: boolean; recarregar: () => void }

function Itens({ empresaId, id, d, editar, recarregar }: P) {
  const [f, setF] = useState({ desc: '', un: '', qtd: '', valor: '' })
  const { enviando, erro, enviar } = useEnvio()
  const ok = f.desc.trim().length >= 2 && ehDecimal(f.qtd) && ehDecimal(f.valor)
  return (
    <Cartao>
      <h2>Itens e saldos</h2>
      <Aviso texto={erro} />
      {d.itens.length === 0 ? <Vazio>Nenhum item. O valor do contrato é a soma dos itens.</Vazio> : <ul className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl ring-1 ring-secondary">{d.itens.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center gap-3 p-3 text-sm"><span className="w-full min-w-0 [overflow-wrap:anywhere] sm:flex-1"><strong>Item {i.numeroItem}</strong> · <bdi>{i.descricao}</bdi> · {reais(i.valorUnitario)} cada</span>
          <span className="text-secondary">Contratado {semZeros(i.quantidade)} · empenhado {semZeros(i.empenhado)} · entregue {semZeros(i.entregue)} · <strong className="text-primary">a empenhar {semZeros(i.saldoAEmpenhar)}</strong></span></li>))}</ul>}
      {editar ? <div className="grid grid-cols-1 gap-3 rounded-xl bg-secondary p-4 sm:grid-cols-4"><Campo rotulo="Descrição" value={f.desc} onChange={(v) => setF({ ...f, desc: v })} maxLength={2000} /><Campo rotulo="Unidade" value={f.un} onChange={(v) => setF({ ...f, un: v })} maxLength={40} /><Campo rotulo="Quantidade" inputMode="decimal" value={f.qtd} onChange={(v) => setF({ ...f, qtd: v })} /><Campo rotulo="Valor unitário (R$)" inputMode="decimal" value={f.valor} onChange={(v) => setF({ ...f, valor: v })} />
        <div><Botao carregando={enviando} disabled={!ok} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/contratos/${id}/itens`, { numeroItem: d.itens.length + 1, descricao: f.desc.trim(), unidade: f.un.trim() || null, quantidade: paraDecimal(f.qtd), valorUnitario: paraDecimal(f.valor) }); setF({ desc: '', un: '', qtd: '', valor: '' }); recarregar() })}>Adicionar item</Botao></div></div> : null}
    </Cartao>
  )
}

function Empenhos({ empresaId, id, d, editar, recarregar }: P) {
  const [f, setF] = useState({ numero: '', tipo: 'empenho', emitido: '', prazo: '', item: '', qtd: '' })
  const [ent, setEnt] = useState<Record<string, { q: string; data: string; rec: string }>>({})
  const { enviando, erro, enviar } = useEnvio()
  return (
    <div className="flex flex-col gap-4">
      <Aviso texto={erro} />
      {d.empenhos.length === 0 ? <Vazio>Nenhum empenho ou ordem de fornecimento.</Vazio> : d.empenhos.map((e) => (
        <Cartao key={e.id}>
          <div className="flex flex-wrap items-center gap-2"><h2 className="min-w-0 flex-1">{e.tipo === 'ordem_fornecimento' ? 'Ordem' : 'Empenho'} {e.numero}</h2><Etiqueta cor="marca">{ETAPAS[e.etapa] ?? e.etapa}</Etiqueta></div>
          <Legenda>Emitido em {dia(e.emitidoEm)}{e.prazoEntrega ? ` · prazo de entrega ${dia(e.prazoEntrega)}` : ''}</Legenda>
          {e.itens.map((i) => {
            const v = ent[i.id] ?? { q: '', data: '', rec: 'provisorio' }
            return (
              <div key={i.id} className="flex flex-wrap items-end gap-3 rounded-xl bg-secondary p-3 text-sm"><span className="min-w-0 flex-1">Item {i.numeroItem}: empenhado {semZeros(i.quantidade)} · entregue {semZeros(i.entregue)}</span>
                {editar ? <><div className="w-full min-w-0 sm:w-28"><Campo rotulo="Entregue agora" inputMode="decimal" value={v.q} onChange={(x) => setEnt({ ...ent, [i.id]: { ...v, q: x } })} /></div><div className="w-full min-w-0 sm:w-40"><Campo rotulo="Data" type="date" value={v.data} onChange={(x) => setEnt({ ...ent, [i.id]: { ...v, data: x } })} /></div>
                  <div className="w-full min-w-0 sm:w-40"><Selecao rotulo="Recebimento" value={v.rec} onChange={(x) => setEnt({ ...ent, [i.id]: { ...v, rec: x } })} opcoes={[{ valor: 'provisorio', rotulo: 'Provisório' }, { valor: 'definitivo', rotulo: 'Definitivo' }]} /></div>
                  <Botao variante="secundario" carregando={enviando} disabled={!ehDecimal(v.q) || !v.data} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/empenho-itens/${i.id}/entregas`, { quantidade: paraDecimal(v.q), data: v.data, recebimento: v.rec }); setEnt({ ...ent, [i.id]: { q: '', data: '', rec: 'provisorio' } }); recarregar() })}>Registrar entrega</Botao></> : null}</div>
            )
          })}
          {e.entregas.length ? <Legenda>Entregas: {e.entregas.map((x) => `${semZeros(x.quantidade)} em ${dia(x.data)} (${x.recebimento})`).join(' · ')}</Legenda> : null}
          {editar ? <div className="flex flex-wrap items-end gap-3"><div className="w-full min-w-0 sm:min-w-64"><Selecao rotulo="Etapa do fornecimento" value={e.etapa} onChange={(v) => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/empenhos/${e.id}/etapa`, { etapa: v }); recarregar() })} opcoes={Object.entries(ETAPAS).map(([valor, rotulo]) => ({ valor, rotulo }))} /></div></div> : null}
          <Legenda>Histórico: {e.etapas.map((x) => ETAPAS[x.etapa] ?? x.etapa).join(' → ')}</Legenda>
        </Cartao>
      ))}
      {editar && d.itens.length ? (
        <Cartao><h2>Novo empenho ou ordem de fornecimento</h2><Legenda>O banco recusa quantidade acima do saldo a empenhar do item.</Legenda>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6"><Campo rotulo="Número" value={f.numero} onChange={(v) => setF({ ...f, numero: v })} maxLength={80} /><Selecao rotulo="Tipo" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} opcoes={[{ valor: 'empenho', rotulo: 'Empenho' }, { valor: 'ordem_fornecimento', rotulo: 'Ordem de fornecimento' }]} />
            <Campo rotulo="Emitido em" type="date" value={f.emitido} onChange={(v) => setF({ ...f, emitido: v })} /><Campo rotulo="Prazo de entrega" type="date" value={f.prazo} onChange={(v) => setF({ ...f, prazo: v })} />
            <Selecao rotulo="Item" value={f.item} onChange={(v) => setF({ ...f, item: v })} vazio="Escolha" opcoes={d.itens.map((i) => ({ valor: i.id, rotulo: `Item ${i.numeroItem} (saldo ${semZeros(i.saldoAEmpenhar)})` }))} /><Campo rotulo="Quantidade" inputMode="decimal" value={f.qtd} onChange={(v) => setF({ ...f, qtd: v })} /></div>
          <div><Botao carregando={enviando} disabled={!f.numero.trim() || !f.emitido || !f.item || !ehDecimal(f.qtd)} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/contratos/${id}/empenhos`, { tipo: f.tipo, numero: f.numero.trim(), emitidoEm: f.emitido, prazoEntrega: f.prazo || null, itens: [{ contratoItemId: f.item, quantidade: paraDecimal(f.qtd) }] }); setF({ ...f, numero: '', qtd: '' }); recarregar() })}>Registrar</Botao></div></Cartao>
      ) : null}
    </div>
  )
}

function Financeiro({ empresaId, id, d, editar, recarregar }: P) {
  const [f, setF] = useState({ nf: '', emissao: '', valor: '', ret: '0', venc: '' })
  const [pg, setPg] = useState<Record<string, { data: string; valor: string; oc: string }>>({})
  const { enviando, erro, enviar } = useEnvio()
  const ok = f.nf.trim() !== '' && f.emissao !== '' && f.venc !== '' && ehDecimal(f.valor) && ehDecimal(f.ret)
  return (
    <Cartao>
      <h2>Financeiro</h2>
      <Legenda>Retenções tributárias são valores informados por você (o sistema não calcula alíquotas). 🧾 A diferença entre o faturado e o recebido fica como pendente.</Legenda>
      <Aviso texto={erro} />
      {(d.faturas ?? []).length === 0 ? <Vazio>Nenhuma nota fiscal registrada.</Vazio> : <ul className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl ring-1 ring-secondary">{(d.faturas ?? []).map((x) => {
        const v = pg[x.id] ?? { data: '', valor: '', oc: '' }
        return (
          <li key={x.id} className="flex flex-col gap-2 p-3 text-sm"><span className="flex flex-wrap items-center gap-2"><strong>NF {x.numeroNf}</strong> · {reais(x.valor)} · retenções {reais(x.retencoes)} · vence {dia(x.vencimento)}{x.pagoEm ? <Etiqueta cor="sucesso">Pago em {dia(x.pagoEm)}: {reais(x.valorRecebido)}</Etiqueta> : x.diasAtraso > 0 ? <Etiqueta cor="erro">{x.diasAtraso} dia(s) de atraso</Etiqueta> : <Etiqueta cor="aviso">A receber</Etiqueta>}</span>
            <Legenda>Pendente: {reais(x.aReceber)}{x.ocorrencia ? ` · ocorrência: ${x.ocorrencia}` : ''}</Legenda>
            {editar && !x.pagoEm ? <div className="flex flex-wrap items-end gap-3"><div className="w-full min-w-0 sm:w-40"><Campo rotulo="Pago em" type="date" value={v.data} onChange={(a) => setPg({ ...pg, [x.id]: { ...v, data: a } })} /></div><div className="w-full min-w-0 sm:w-40"><Campo rotulo="Valor recebido (R$)" inputMode="decimal" value={v.valor} onChange={(a) => setPg({ ...pg, [x.id]: { ...v, valor: a } })} /></div><div className="w-full min-w-0 sm:min-w-48 sm:flex-1"><Campo rotulo="Ocorrência (opcional)" value={v.oc} onChange={(a) => setPg({ ...pg, [x.id]: { ...v, oc: a } })} maxLength={1000} /></div>
              <Botao variante="secundario" carregando={enviando} disabled={!v.data || !ehDecimal(v.valor)} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/faturas/${x.id}/pagamento`, { pagoEm: v.data, valorRecebido: paraDecimal(v.valor), ocorrencia: v.oc.trim() || null }); recarregar() })}>Registrar pagamento</Botao></div> : null}</li>
        )
      })}</ul>}
      {editar ? <div className="grid grid-cols-1 gap-3 rounded-xl bg-secondary p-4 sm:grid-cols-5"><Campo rotulo="Nota fiscal" value={f.nf} onChange={(v) => setF({ ...f, nf: v })} maxLength={60} /><Campo rotulo="Emissão" type="date" value={f.emissao} onChange={(v) => setF({ ...f, emissao: v })} /><Campo rotulo="Valor (R$)" inputMode="decimal" value={f.valor} onChange={(v) => setF({ ...f, valor: v })} /><Campo rotulo="Retenções (R$)" inputMode="decimal" value={f.ret} onChange={(v) => setF({ ...f, ret: v })} /><Campo rotulo="Vencimento" type="date" value={f.venc} onChange={(v) => setF({ ...f, venc: v })} />
        <div><Botao carregando={enviando} disabled={!ok} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/contratos/${id}/faturas`, { numeroNf: f.nf.trim(), emitidaEm: f.emissao, valor: paraDecimal(f.valor), retencoes: paraDecimal(f.ret), vencimento: f.venc }); setF({ nf: '', emissao: '', valor: '', ret: '0', venc: '' }); recarregar() })}>Registrar nota</Botao></div></div> : null}
    </Cartao>
  )
}

function Historico({ empresaId, id, d, editar, recarregar }: P) {
  const [f, setF] = useState({ tipo: 'aditivo', data: '', desc: '', valor: '', vig: '' })
  const { enviando, erro, enviar } = useEnvio()
  return (
    <Cartao>
      <h2>Histórico contratual</h2>
      <Legenda>⚖️ Reajuste e reequilíbrio ficam registrados aqui; a análise e a minuta do pedido são do módulo jurídico.</Legenda>
      <Aviso texto={erro} />
      {d.eventos.length === 0 ? <Vazio>Sem aditivos, apostilamentos ou ocorrências.</Vazio> : <ul className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl ring-1 ring-secondary">{d.eventos.map((e) => (
        <li key={e.id} className="flex flex-col gap-1 p-3 text-sm"><span><strong>{TIPO_EVENTO_CONTRATO[e.tipo] ?? e.tipo}</strong> · {dia(e.data)}</span><span className="[overflow-wrap:anywhere]"><bdi>{e.descricao}</bdi></span>
          {e.valorDepois ? <Legenda>Valor: {reais(e.valorAntes)} → {reais(e.valorDepois)}</Legenda> : null}{e.vigenciaDepois ? <Legenda>Vigência até: {dia(e.vigenciaAntes)} → {dia(e.vigenciaDepois)}</Legenda> : null}</li>))}</ul>}
      {editar ? <div className="grid grid-cols-1 gap-3 rounded-xl bg-secondary p-4 sm:grid-cols-5"><Selecao rotulo="Tipo" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} opcoes={Object.entries(TIPO_EVENTO_CONTRATO).map(([valor, rotulo]) => ({ valor, rotulo }))} /><Campo rotulo="Data" type="date" value={f.data} onChange={(v) => setF({ ...f, data: v })} /><Campo rotulo="Descrição" value={f.desc} onChange={(v) => setF({ ...f, desc: v })} maxLength={2000} />
        <Campo rotulo="Novo valor total (opcional, R$)" inputMode="decimal" value={f.valor} onChange={(v) => setF({ ...f, valor: v })} /><Campo rotulo="Nova vigência (opcional)" type="date" value={f.vig} onChange={(v) => setF({ ...f, vig: v })} />
        <div><Botao carregando={enviando} disabled={!f.data || f.desc.trim().length < 3 || (f.valor !== '' && !ehDecimal(f.valor))} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/contratos/${id}/eventos`, { tipo: f.tipo, data: f.data, descricao: f.desc.trim(), novoValor: f.valor ? paraDecimal(f.valor) : null, novaVigencia: f.vig || null }); setF({ ...f, desc: '', valor: '', vig: '' }); recarregar() })}>Registrar</Botao></div></div> : null}
    </Cartao>
  )
}
