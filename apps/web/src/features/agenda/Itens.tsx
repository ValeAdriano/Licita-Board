import { useState } from 'react'
import { Link } from 'react-router'
import { chamar } from '../../api/cliente'
import { AreaTexto, Aviso, Botao, Caixa, Campo, Etiqueta, Legenda, Modal, Selecao } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useAcesso } from '../acesso/contexto'
import { BENEFICIO, moeda } from '../pesquisa/formato'
import { RegistrarResultado } from '../resultados/RegistrarResultado'
import { PRIORIDADE, SITUACAO, STATUS_PART } from './comum'
import type { Detalhe, ItemPart } from './tiposAcompanhamento'

const opcoes = (m: Record<string, string>) => Object.entries(m).map(([valor, rotulo]) => ({ valor, rotulo }))

// Itens do edital, um por linha. Quem decide participar de um item cria a participação (status, situações,
// marca/modelo, valores). Atendimento técnico por IA e preços entram nas Fases 6 e 7; aqui só digitação.
export function Itens({ empresaId, d, responsaveis, podeCadastrar, podeEditar, aoMudar }: {
  empresaId: string; d: Detalhe; responsaveis: { id: string; nome: string }[]; podeCadastrar: boolean; podeEditar: boolean; aoMudar: () => void
}) {
  const { pode } = useAcesso()
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [editando, setEditando] = useState<ItemPart | null>(null)
  const [resultadoDe, setResultadoDe] = useState<string | null>(null)
  const { enviando, erro, enviar } = useEnvio()
  const livres = d.itens.filter((i) => !i.participacaoId && !i.retirado)
  const alternar = (id: string, v: boolean) => { const n = new Set(marcados); if (v) n.add(id); else n.delete(id); setMarcados(n) }
  const participar = (ids: string[]) =>
    enviar(async () => { await chamar('POST', `/empresas/${empresaId}/acompanhamentos/${d.id}/participacoes`, { itemIds: ids }); setMarcados(new Set()); aoMudar() })
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-itens">
      <h2 id="h-itens">Itens ({d.itens.length})</h2>
      <Legenda>Cada item do edital é uma linha: você escolhe de quais participa. Um edital de 8 itens tem 8 linhas.</Legenda>
      <Aviso texto={erro} />
      {podeCadastrar && livres.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Botao variante="secundario" disabled={marcados.size === 0} carregando={enviando} onClick={() => void participar([...marcados])}>Participar dos selecionados ({marcados.size})</Botao>
          <Botao variante="texto" onClick={() => setMarcados(new Set(livres.map((i) => i.itemId)))}>Marcar todos os livres</Botao>
        </div>
      ) : null}
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl ring-1 ring-secondary">
        {d.itens.map((i) => (
          <div key={i.itemId} className={`flex flex-col gap-2 p-3 ${i.retirado ? 'opacity-55' : ''}`}>
            <div className="flex items-start gap-3">
              {podeCadastrar && !i.participacaoId && !i.retirado ? <Caixa rotulo={`Selecionar item ${i.numeroItem}`} marcado={marcados.has(i.itemId)} onChange={(v) => alternar(i.itemId, v)} /> : null}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <strong className="text-sm text-primary">Item {i.numeroItem}{i.retirado ? ' (retirado em retificação)' : ''}</strong>
                <span className="text-sm text-secondary [overflow-wrap:anywhere]"><bdi>{i.descricao}</bdi></span>
                <Legenda>{i.quantidade ?? '—'} {i.unidadeMedida ?? ''} · estimado {moeda(i.valorEstimado)} · {BENEFICIO[i.beneficio] ?? i.beneficio}</Legenda>
                {i.participacaoId ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <Etiqueta cor="marca">{STATUS_PART[i.status ?? ''] ?? i.status}</Etiqueta>
                    <Etiqueta cor="cinza">Documentação: {SITUACAO[i.situacaoDocumentacao ?? ''] ?? '—'}</Etiqueta>
                    <Etiqueta cor="cinza">Proposta: {SITUACAO[i.situacaoProposta ?? ''] ?? '—'}</Etiqueta>
                    <Etiqueta cor="cinza">Jurídica: {SITUACAO[i.situacaoJuridica ?? ''] ?? '—'}</Etiqueta>
                    {i.marca ? <Etiqueta cor="cinza"><bdi>{i.marca}{i.modelo ? ` ${i.modelo}` : ''}</bdi></Etiqueta> : null}
                    {i.valorUnitario ? <Etiqueta cor="cinza">Unitário {moeda(i.valorUnitario)}</Etiqueta> : null}
                  </span>
                ) : null}
              </div>
              {i.participacaoId ? (
                <span className="flex flex-wrap items-center gap-2">
                  {pode('precos', 'ver_custos_margens') ? <Link to={`/agenda/participacoes/${i.participacaoId}/preco`}>Preço</Link> : null}
                  {pode('analises', 'visualizar') ? <Link to={`/agenda/participacoes/${i.participacaoId}/analise`}>Análise técnica</Link> : null}
                  {podeEditar ? <Botao variante="secundario" onClick={() => setResultadoDe(i.participacaoId)}>Resultado</Botao> : null}
                  {podeEditar ? <Botao variante="secundario" onClick={() => setEditando(i)}>Editar</Botao> : null}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {resultadoDe ? <RegistrarResultado empresaId={empresaId} participacaoId={resultadoDe} aoFechar={() => setResultadoDe(null)} aoSalvar={() => { setResultadoDe(null); aoMudar() }} /> : null}
      {editando ? <EditarParticipacao empresaId={empresaId} item={editando} responsaveis={responsaveis} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); aoMudar() }} /> : null}
    </section>
  )
}

function EditarParticipacao({ empresaId, item, responsaveis, aoFechar, aoSalvar }: {
  empresaId: string; item: ItemPart; responsaveis: { id: string; nome: string }[]; aoFechar: () => void; aoSalvar: () => void
}) {
  const [f, setF] = useState({
    status: item.status ?? 'avaliando', prioridade: item.prioridade ?? 'normal', responsavelId: item.responsavelId ?? '',
    situacaoDocumentacao: item.situacaoDocumentacao ?? 'a_confirmar', situacaoProposta: item.situacaoProposta ?? 'a_confirmar', situacaoJuridica: item.situacaoJuridica ?? 'a_confirmar',
    atendimentoTecnico: item.atendimentoTecnico ?? '', marca: item.marca ?? '', modelo: item.modelo ?? '', versao: item.versao ?? '',
    valorUnitario: item.valorUnitario ?? '', valorTotal: item.valorTotal ?? '', pendencias: item.pendencias ?? '', observacoes: item.observacoes ?? '',
  })
  const { enviando, erro, enviar } = useEnvio()
  const decimal = (v: string) => (v.trim() === '' ? null : v.trim().replace(',', '.'))
  const salvar = () =>
    enviar(async () => {
      await chamar('PATCH', `/empresas/${empresaId}/participacoes/${item.participacaoId}`, {
        status: f.status, prioridade: f.prioridade, responsavelId: f.responsavelId || null,
        situacaoDocumentacao: f.situacaoDocumentacao, situacaoProposta: f.situacaoProposta, situacaoJuridica: f.situacaoJuridica,
        atendimentoTecnico: f.atendimentoTecnico || null, marca: f.marca || null, modelo: f.modelo || null, versao: f.versao || null,
        valorUnitario: decimal(f.valorUnitario), valorTotal: decimal(f.valorTotal), pendencias: f.pendencias || null, observacoes: f.observacoes || null,
      })
      aoSalvar()
    })
  return (
    <Modal aberto titulo={`Participação no item ${item.numeroItem}`} aoFechar={aoFechar}>
      <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1">
        <Selecao rotulo="Situação da participação" value={f.status} onChange={(v) => setF({ ...f, status: v })} opcoes={opcoes(STATUS_PART)} />
        <Selecao rotulo="Prioridade" value={f.prioridade} onChange={(v) => setF({ ...f, prioridade: v })} opcoes={opcoes(PRIORIDADE)} />
        <Selecao rotulo="Responsável" value={f.responsavelId} onChange={(v) => setF({ ...f, responsavelId: v })} vazio="Sem responsável" opcoes={responsaveis.map((r) => ({ valor: r.id, rotulo: r.nome }))} />
        <Selecao rotulo="Documentação" value={f.situacaoDocumentacao} onChange={(v) => setF({ ...f, situacaoDocumentacao: v })} opcoes={opcoes(SITUACAO)} />
        <Selecao rotulo="Proposta" value={f.situacaoProposta} onChange={(v) => setF({ ...f, situacaoProposta: v })} opcoes={opcoes(SITUACAO)} />
        <Selecao rotulo="Situação jurídica" value={f.situacaoJuridica} onChange={(v) => setF({ ...f, situacaoJuridica: v })} opcoes={opcoes(SITUACAO)} />
        <Campo rotulo="Marca" value={f.marca} onChange={(v) => setF({ ...f, marca: v })} maxLength={120} />
        <Campo rotulo="Modelo" value={f.modelo} onChange={(v) => setF({ ...f, modelo: v })} maxLength={120} />
        <Campo rotulo="Versão" value={f.versao} onChange={(v) => setF({ ...f, versao: v })} maxLength={120} />
        <Campo rotulo="Valor unitário (R$)" inputMode="decimal" value={f.valorUnitario} onChange={(v) => setF({ ...f, valorUnitario: v })} dica="Digitação manual. A formação de preço entra na Fase 7." />
        <Campo rotulo="Valor total (R$)" inputMode="decimal" value={f.valorTotal} onChange={(v) => setF({ ...f, valorTotal: v })} />
        <AreaTexto rotulo="Atendimento técnico" rows={3} value={f.atendimentoTecnico} onChange={(v) => setF({ ...f, atendimentoTecnico: v })} maxLength={2000} dica="EM DESENVOLVIMENTO: a análise técnica por IA entra na Fase 6; por ora é anotação sua." />
        <AreaTexto rotulo="Pendências" rows={2} value={f.pendencias} onChange={(v) => setF({ ...f, pendencias: v })} maxLength={2000} />
        <AreaTexto rotulo="Observações" rows={2} value={f.observacoes} onChange={(v) => setF({ ...f, observacoes: v })} maxLength={4000} />
      </div>
      <Aviso texto={erro} />
      <div className="flex flex-wrap gap-3">
        <Botao carregando={enviando} onClick={() => void salvar()}>Salvar</Botao>
        <Botao variante="texto" onClick={aoFechar}>Cancelar</Botao>
      </div>
    </Modal>
  )
}
