import { useState } from 'react'
import { chamar } from '../../api/cliente'
import { AreaTexto, Aviso, Botao, Campo, Etiqueta, Legenda, Selecao, Vazio } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { dataHoraSP } from '../agenda/comum'
import { ehDecimal, paraDecimal, pct, reais, semZeros, TIPO_LINHA } from './formato'

export interface Precificacao {
  id: string; quantidade: string; valorEstimadoUnit: string | null; margemDesejada: string; margemMinima: string; casas: number; arredondamento: string
  precoProposto: string | null; limiteInexequivel: string | null; meEpp: boolean; modalidade: string | null
  custoDiretoUnit: string | null; percentuaisSobrePreco: string | null; precoMinimoUnit: string | null; precoOfertaUnit: string | null; precoFinalUnit: string | null
  totalProposta: string | null; margemBruta: string | null; margemLiquida: string | null; diferencaEstimado: string | null; abaixoDoMinimo: boolean | null
  riscoInexequivel: string | null; erroCalculo: string | null; calculadoEm: string | null; justificativaAbaixo: string | null; aprovadoEm: string | null; aprovadoPor: string | null
}
export interface LinhaPreco { id: string; nome: string; tipo: string; categoria: 'custo' | 'percentual'; forma: string | null; valor: string | null; percentual: string | null; validadoEm: string | null; validadoPor: string | null }
export interface DadosPreco { precificacao: Precificacao | null; item: { numeroItem: number | null; descricao: string | null; quantidade: string | null; unidadeMedida: string | null; valorUnitarioEstimado: string | null } | null; linhas: LinhaPreco[]; produtos: { id: string; codigoInterno: string; marca: string | null; modelo: string | null; descricao: string }[] }

// Calculadora de preços do item. Quem calcula é o sistema (código com Decimal, nunca a IA nem o navegador); aqui só se
// informam custos e parâmetros. Valores monetários trafegam como texto decimal. 🧾 Tributos só valem validados pelo responsável.
export function Calculadora({ empresaId, participacaoId, d, podeEditar, podeAprovar, aoMudar }: { empresaId: string; participacaoId: string; d: DadosPreco; podeEditar: boolean; podeAprovar: boolean; aoMudar: () => void }) {
  const p = d.precificacao
  const criar = useEnvio()
  const [produto, setProduto] = useState('')
  if (!p) {
    return (
      <section className="flex flex-col gap-3 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6">
        <h2>Precificar este item</h2>
        <Legenda>Quantidade {d.item?.quantidade ? semZeros(d.item.quantidade) : '—'} {d.item?.unidadeMedida ?? ''} · valor estimado do edital {reais(d.item?.valorUnitarioEstimado, 2)} por unidade.</Legenda>
        <Aviso texto={criar.erro} />
        {podeEditar ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1"><Selecao rotulo="Produto (opcional)" value={produto} onChange={setProduto} vazio="Sem produto" opcoes={d.produtos.map((x) => ({ valor: x.id, rotulo: `${x.codigoInterno} · ${x.descricao}`.slice(0, 80) }))} /></div>
            <Botao carregando={criar.enviando} onClick={() => void criar.enviar(async () => { await chamar('POST', `/empresas/${empresaId}/participacoes/${participacaoId}/preco`, { produtoId: produto || null }); aoMudar() })}>Iniciar precificação</Botao>
          </div>
        ) : <Vazio>Ainda não há precificação para este item.</Vazio>}
      </section>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      <Resultado p={p} />
      <Linhas empresaId={empresaId} p={p} linhas={d.linhas} podeEditar={podeEditar} podeAprovar={podeAprovar} aoMudar={aoMudar} />
      <Parametros empresaId={empresaId} p={p} podeEditar={podeEditar} aoMudar={aoMudar} />
      <Aprovacao empresaId={empresaId} p={p} podeAprovar={podeAprovar} aoMudar={aoMudar} />
    </div>
  )
}

function Resultado({ p }: { p: Precificacao }) {
  const c = p.casas
  const linha = (rotulo: string, valor: string, destaque = false) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-secondary py-2 last:border-0"><span className="text-sm text-secondary">{rotulo}</span><span className={destaque ? 'text-lg font-semibold text-primary' : 'text-sm text-primary'}>{valor}</span></div>
  )
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-res">
      <h2 id="h-res">Resultado</h2>
      {p.calculadoEm === null ? <Aviso tipo="info" texto="Calculando… atualize em instantes." /> : null}
      <Aviso texto={p.erroCalculo} />
      {p.abaixoDoMinimo ? <Aviso tipo="atencao" texto="O preço final está ABAIXO do preço mínimo (margem mínima). A aprovação exige justificativa e quem tem permissão de aprovar." /> : null}
      {p.riscoInexequivel === 'RISCO' ? <Aviso tipo="atencao" texto={`Risco de inexequibilidade: o preço final está abaixo de ${pct(p.limiteInexequivel)} do valor estimado.`} /> : null}
      {p.riscoInexequivel === 'NAO_PARAMETRIZADO' && p.calculadoEm ? <Legenda>Inexequibilidade: critério não parametrizado (⚖️ informe o limite do edital para avaliar).</Legenda> : null}
      {p.precoFinalUnit !== null ? (
        <div className="flex flex-col">
          {linha('Custo direto por unidade', reais(p.custoDiretoUnit, 4))}
          {linha('Percentuais sobre o preço (tributos, comissão...)', pct(p.percentuaisSobrePreco))}
          {linha('Preço mínimo (margem mínima)', reais(p.precoMinimoUnit, c))}
          {linha('Preço de oferta (margem desejada)', reais(p.precoOfertaUnit, c))}
          {linha(p.precoProposto ? 'Preço final por unidade (proposto)' : 'Preço final por unidade', reais(p.precoFinalUnit, c), true)}
          {linha(`Total da proposta (${semZeros(p.quantidade)} × preço unitário arredondado)`, reais(p.totalProposta, 2), true)}
          {linha('Margem bruta', pct(p.margemBruta))}
          {linha('Margem após percentuais', pct(p.margemLiquida))}
          {linha('Diferença para o valor estimado', pct(p.diferencaEstimado))}
        </div>
      ) : null}
      {p.calculadoEm ? <Legenda>Calculado em {dataHoraSP(p.calculadoEm)}.</Legenda> : null}
    </section>
  )
}

function Linhas({ empresaId, p, linhas, podeEditar, podeAprovar, aoMudar }: { empresaId: string; p: Precificacao; linhas: LinhaPreco[]; podeEditar: boolean; podeAprovar: boolean; aoMudar: () => void }) {
  const [f, setF] = useState({ nome: '', tipo: 'aquisicao', categoria: 'custo', forma: 'por_unidade', numero: '' })
  const { enviando, erro, enviar } = useEnvio()
  const valido = f.nome.trim().length >= 2 && ehDecimal(f.numero)
  const salvar = () =>
    enviar(async () => {
      const n = paraDecimal(f.numero)
      await chamar('POST', `/empresas/${empresaId}/precificacoes/${p.id}/linhas`, f.categoria === 'custo'
        ? { nome: f.nome.trim(), tipo: f.tipo, categoria: 'custo', forma: f.forma, valor: n }
        : { nome: f.nome.trim(), tipo: f.tipo, categoria: 'percentual', percentual: n })
      setF({ ...f, nome: '', numero: '' })
      aoMudar()
    })
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-lin">
      <h2 id="h-lin">Custos e percentuais ({linhas.length})</h2>
      <Legenda>Cada custo é uma linha identificada. “Percentual sobre o preço” entra no cálculo como parte do preço (tributos, comissão, despesas). 🧾 Alíquotas precisam da validação do responsável contábil antes do uso real.</Legenda>
      <Aviso texto={erro} />
      {linhas.length === 0 ? <Vazio>Nenhum custo cadastrado ainda.</Vazio> : (
        <ul className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl ring-1 ring-secondary">
          {linhas.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]"><strong className="text-primary"><bdi>{l.nome}</bdi></strong> · {TIPO_LINHA[l.tipo] ?? l.tipo} · {l.categoria === 'custo' ? `${reais(l.valor, 4)} ${l.forma === 'total_lote' ? 'no lote todo' : 'por unidade'}` : `${pct(l.percentual)} sobre o preço`}</span>
              {l.validadoEm ? <Etiqueta cor="sucesso">🧾 validado por {l.validadoPor}</Etiqueta> : l.tipo === 'tributo' ? <Etiqueta cor="aviso">🧾 não validado pelo contador</Etiqueta> : null}
              {podeAprovar && !l.validadoEm ? <Botao variante="secundario" disabled={enviando} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/preco-linhas/${l.id}/validar`); aoMudar() })}>Marcar como validado</Botao> : null}
              {podeEditar ? <Botao variante="texto" disabled={enviando} onClick={() => void enviar(async () => { await chamar('DELETE', `/empresas/${empresaId}/preco-linhas/${l.id}`); aoMudar() })}>Remover</Botao> : null}
            </li>
          ))}
        </ul>
      )}
      {podeEditar ? (
        <div className="grid grid-cols-1 gap-3 rounded-xl bg-secondary p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Nome" value={f.nome} onChange={(v) => setF({ ...f, nome: v })} maxLength={120} />
          <Selecao rotulo="Tipo" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} opcoes={Object.entries(TIPO_LINHA).map(([valor, rotulo]) => ({ valor, rotulo }))} />
          <Selecao rotulo="Como entra" value={f.categoria} onChange={(v) => setF({ ...f, categoria: v })} opcoes={[{ valor: 'custo', rotulo: 'Custo em reais' }, { valor: 'percentual', rotulo: 'Percentual sobre o preço' }]} />
          {f.categoria === 'custo' ? <Selecao rotulo="Base" value={f.forma} onChange={(v) => setF({ ...f, forma: v })} opcoes={[{ valor: 'por_unidade', rotulo: 'Por unidade' }, { valor: 'total_lote', rotulo: 'Do lote inteiro' }]} /> : null}
          <Campo rotulo={f.categoria === 'custo' ? 'Valor (R$)' : 'Percentual (%)'} inputMode="decimal" value={f.numero} onChange={(v) => setF({ ...f, numero: v })} dica="Use vírgula ou ponto." erro={f.numero !== '' && !ehDecimal(f.numero)} />
          <div className="flex items-end"><Botao carregando={enviando} disabled={!valido} onClick={() => void salvar()}>Adicionar</Botao></div>
        </div>
      ) : null}
    </section>
  )
}

function Parametros({ empresaId, p, podeEditar, aoMudar }: { empresaId: string; p: Precificacao; podeEditar: boolean; aoMudar: () => void }) {
  const virgula = (v: string | null) => (v ?? '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace('.', ',')
  const [f, setF] = useState({ qtd: virgula(p.quantidade), desejada: virgula(p.margemDesejada), minima: virgula(p.margemMinima), casas: String(p.casas), modo: p.arredondamento, proposto: virgula(p.precoProposto), limite: virgula(p.limiteInexequivel) })
  const { enviando, erro, ok, enviar } = useEnvio()
  const valido = ehDecimal(f.qtd) && ehDecimal(f.desejada) && ehDecimal(f.minima) && (f.proposto === '' || ehDecimal(f.proposto)) && (f.limite === '' || ehDecimal(f.limite))
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-par">
      <h2 id="h-par">Parâmetros do edital e da margem</h2>
      <Aviso texto={erro} />
      {ok ? <Aviso tipo="info" texto={ok} /> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo rotulo="Quantidade" inputMode="decimal" value={f.qtd} onChange={(v) => setF({ ...f, qtd: v })} disabled={!podeEditar} />
        <Campo rotulo="Margem desejada (%)" inputMode="decimal" value={f.desejada} onChange={(v) => setF({ ...f, desejada: v })} disabled={!podeEditar} />
        <Campo rotulo="Margem mínima (%)" inputMode="decimal" value={f.minima} onChange={(v) => setF({ ...f, minima: v })} disabled={!podeEditar} />
        <Selecao rotulo="Casas do preço unitário (exigência do edital)" value={f.casas} onChange={(v) => setF({ ...f, casas: v })} opcoes={['2', '3', '4', '5', '6'].map((n) => ({ valor: n, rotulo: `${n} casas` }))} />
        <Selecao rotulo="Arredondamento" value={f.modo} onChange={(v) => setF({ ...f, modo: v })} opcoes={[{ valor: 'half_up', rotulo: 'Arredondar (meio para cima)' }, { valor: 'truncar', rotulo: 'Truncar' }]} />
        <Campo rotulo="Preço unitário proposto (opcional)" inputMode="decimal" value={f.proposto} onChange={(v) => setF({ ...f, proposto: v })} dica="Vazio usa o preço de oferta calculado." disabled={!podeEditar} />
        <Campo rotulo="Limite de inexequibilidade (% do estimado, opcional)" inputMode="decimal" value={f.limite} onChange={(v) => setF({ ...f, limite: v })} dica="⚖️ Critério do edital. Vazio = não avaliado." disabled={!podeEditar} />
      </div>
      {podeEditar ? <div><Botao carregando={enviando} disabled={!valido} onClick={() => void enviar(async () => {
        await chamar('POST', `/empresas/${empresaId}/precificacoes/${p.id}/parametros`, {
          quantidade: paraDecimal(f.qtd), margemDesejada: paraDecimal(f.desejada), margemMinima: paraDecimal(f.minima), casas: Number(f.casas), arredondamento: f.modo,
          precoProposto: f.proposto ? paraDecimal(f.proposto) : null, limiteInexequivel: f.limite ? paraDecimal(f.limite) : null, meEpp: p.meEpp, modalidade: p.modalidade,
        })
        aoMudar()
        return 'Salvo. Recalculando…'
      })}>Salvar e recalcular</Botao></div> : null}
    </section>
  )
}

function Aprovacao({ empresaId, p, podeAprovar, aoMudar }: { empresaId: string; p: Precificacao; podeAprovar: boolean; aoMudar: () => void }) {
  const [just, setJust] = useState('')
  const { enviando, erro, enviar } = useEnvio()
  const pronto = p.calculadoEm !== null && p.erroCalculo === null && p.precoFinalUnit !== null
  const precisaJustificar = p.abaixoDoMinimo === true
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-apr">
      <h2 id="h-apr">Aprovação comercial</h2>
      {p.aprovadoEm ? <Etiqueta cor="sucesso">Aprovado por {p.aprovadoPor ?? '—'} em {dataHoraSP(p.aprovadoEm)}</Etiqueta> : <Legenda>Mudar qualquer custo ou parâmetro derruba a aprovação.</Legenda>}
      {p.justificativaAbaixo ? <Legenda>Justificativa (abaixo do mínimo): <bdi>{p.justificativaAbaixo}</bdi></Legenda> : null}
      <Aviso texto={erro} />
      {podeAprovar && !p.aprovadoEm ? (
        <>
          {precisaJustificar ? <AreaTexto rotulo="Justificativa (obrigatória: preço abaixo do mínimo)" value={just} onChange={setJust} maxLength={1000} /> : null}
          <div><Botao carregando={enviando} disabled={!pronto || (precisaJustificar && just.trim().length < 10)} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/precificacoes/${p.id}/aprovar`, { justificativa: just.trim() || null }); aoMudar() })}>Aprovar preço</Botao></div>
        </>
      ) : null}
    </section>
  )
}
