import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { chamar } from '../../api/cliente'
import { useGet } from '../acesso/useGet'
import { useEnvio } from '../acesso/conta/useEnvio'
import { AreaTexto, Aviso, AvisoNota, Botao, Caixa, Cartao, Etiqueta, Selecao, Table } from '../../ui'

interface Tipo { id: string; nome: string; pasta: string }
export interface Exigencia {
  id: string; tipoId: string; tipoNome: string; aplicavel: boolean; conferenciaManual: boolean; regularidadeFiscal: boolean;
  observacao: string | null; situacao: string | null; documentoId: string | null; validade: string | null;
  diasParaVencer: number | null; aviso: string | null; recalculando: boolean
}
export interface Resultado { dataSessao: string | null; sessaoConfirmada: boolean | null; itens: Exigencia[] }
const SITUACOES: Record<string, string> = { valido: 'Válido', vencido: 'Vencido', vence_antes_da_sessao: 'Vence antes da sessão', ausente: 'Ausente', nao_aplicavel: 'Não aplicável', depende_conferencia: 'Depende de conferência' }
const data = (v: string | null) => v ? v.split('-').reverse().join('/') : '—'

export function Checklist({ empresaId, acompanhamentoId, podeEditar }: { empresaId: string; acompanhamentoId: string; podeEditar: boolean }) {
  const caminho = `/empresas/${empresaId}/acompanhamentos/${acompanhamentoId}/checklist`
  const lista = useGet<Resultado>(caminho)
  const tipos = useGet<Tipo[]>(podeEditar ? '/documentos/tipos' : null)
  const [form, setForm] = useState<Exigencia | 'novo' | null>(null)
  const [rodada, setRodada] = useState(0)
  const tentativas = useRef(0)
  const { enviando, erro, ok, enviar } = useEnvio()
  const mudou = () => { tentativas.current = 0; setRodada(n => n + 1); lista.recarregar() }
  const reler = useEffectEvent(() => lista.recarregar())
  const dados = lista.dados
  useEffect(() => {
    if (!dados?.itens.some(i => i.recalculando) || tentativas.current >= 5) return
    const timer = setTimeout(() => { tentativas.current++; reler() }, 2500)
    return () => clearTimeout(timer)
  }, [dados, rodada])
  const abrirDocumento = (id: string) => enviar(async () => {
    const versoes = await chamar<{ id: string; versao: number; statusArquivo: string }[]>('GET', `/empresas/${empresaId}/documentos/${id}/versoes`)
    const v = versoes.filter(v => v.statusArquivo === 'liberado').sort((a, b) => b.versao - a.versao)[0]
    if (!v) return 'Nenhuma versão liberada disponível.'
    const r = await chamar<{ url: string }>('POST', `/empresas/${empresaId}/versoes/${v.id}/download`)
    window.location.assign(r.url)
  })
  const situacao = (i: Exigencia) => <div className="flex flex-wrap gap-2"><Etiqueta cor={['vencido', 'vence_antes_da_sessao', 'ausente'].includes(i.situacao ?? '') ? 'erro' : i.situacao === 'valido' ? 'sucesso' : 'cinza'}>{i.situacao ? SITUACOES[i.situacao] ?? 'Depende de conferência' : 'Calculando…'}</Etiqueta>{i.recalculando ? <Etiqueta cor="aviso">Recalculando</Etiqueta> : null}</div>
  const validade = (i: Exigencia) => <span>Validade: {data(i.validade)}{i.diasParaVencer !== null ? ` · ${i.diasParaVencer} dias para vencer` : ''}</span>
  const acoes = (i: Exigencia) => <div className="flex flex-wrap gap-2">{i.documentoId ? <Botao variante="texto" carregando={enviando} onClick={() => void abrirDocumento(i.documentoId!)}>Abrir documento</Botao> : null}{podeEditar ? <><Botao variante="secundario" aria-label={`Editar ${i.tipoNome}`} onClick={() => setForm(i)}>Editar</Botao><Botao variante="perigo" aria-label={`Remover ${i.tipoNome}`} carregando={enviando} onClick={() => void enviar(async () => { await chamar('DELETE', `/empresas/${empresaId}/checklist/exigencias/${i.id}`); mudou(); return 'Exigência removida.' })}>Remover</Botao></> : null}</div>
  return <section className="flex min-w-0 flex-col gap-4" aria-label="Documentos do edital">
    <h2>Documentos do edital</h2>
    <Aviso texto={lista.erro ?? erro} /><Aviso tipo="info" texto={ok} />
    {lista.erro ? <Botao variante="secundario" onClick={mudou}>Tentar novamente</Botao> : null}
    {lista.carregando ? <p>Carregando checklist…</p> : null}
    {lista.dados ? <><p>Data da sessão: {data(lista.dados.dataSessao)}</p>{lista.dados.sessaoConfirmada === false ? <Aviso tipo="atencao" texto="Data da sessão a confirmar: o checklist usa a data provisória" /> : null}
    {[...new Set(lista.dados.itens.map(i => i.aviso).filter((v): v is string => !!v))].map(aviso => <AvisoNota key={aviso} resumo="Aviso ME/EPP" texto={aviso} />)}
    {lista.dados.itens.length === 0 ? <p>Nenhuma exigência cadastrada</p> : <>
      <div className="flex flex-col gap-3 md:hidden">{lista.dados.itens.map(i => <Cartao key={i.id}><h3 className="[overflow-wrap:anywhere]">{i.tipoNome}</h3>{situacao(i)}{validade(i)}{i.observacao ? <p className="[overflow-wrap:anywhere]">{i.observacao}</p> : null}{acoes(i)}</Cartao>)}</div>
      <div className="hidden overflow-hidden rounded-xl shadow-xs ring-1 ring-secondary md:block"><Table aria-label="Exigências documentais"><Table.Header><Table.Head id="tipo" isRowHeader label="Tipo" /><Table.Head id="situacao" label="Situação" /><Table.Head id="validade" label="Validade e dias" /><Table.Head id="acoes" label="Documento e ações" /></Table.Header><Table.Body items={lista.dados.itens}>{i => <Table.Row id={i.id}><Table.Cell>{i.tipoNome}{i.observacao ? <p className="max-w-xs whitespace-normal [overflow-wrap:anywhere]">{i.observacao}</p> : null}</Table.Cell><Table.Cell>{situacao(i)}</Table.Cell><Table.Cell>{validade(i)}</Table.Cell><Table.Cell>{acoes(i)}</Table.Cell></Table.Row>}</Table.Body></Table></div>
    </>}</> : null}
    {podeEditar ? <div className="flex flex-wrap gap-3"><Botao onClick={() => setForm('novo')}>Adicionar exigência</Botao><Botao variante="secundario" carregando={enviando} onClick={() => void enviar(async () => { await chamar('POST', `${caminho}/recalcular`); mudou(); return 'Recálculo solicitado.' })}>Recalcular agora</Botao></div> : null}
    {podeEditar && tipos.erro ? <Aviso texto={tipos.erro} /> : null}
    {podeEditar && form ? <Formulario key={form === 'novo' ? 'novo' : form.id} inicial={form === 'novo' ? null : form} tipos={tipos.dados ?? []} enviando={enviando} cancelar={() => setForm(null)} salvar={corpo => void enviar(async () => { await chamar('POST', `${caminho}/exigencias`, corpo); setForm(null); mudou(); return 'Exigência salva.' })} /> : null}
  </section>
}

function Formulario({ inicial, tipos, enviando, cancelar, salvar }: { inicial: Exigencia | null; tipos: Tipo[]; enviando: boolean; cancelar: () => void; salvar: (f: unknown) => void }) {
  const [f, setF] = useState({ tipoId: inicial?.tipoId ?? '', aplicavel: inicial?.aplicavel ?? true, conferenciaManual: inicial?.conferenciaManual ?? false, regularidadeFiscal: inicial?.regularidadeFiscal ?? false, observacao: inicial?.observacao ?? '' })
  return <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); salvar({ ...f, observacao: f.observacao.trim() || null }) }}>
    <Selecao rotulo="Tipo de documento" value={f.tipoId} disabled={!!inicial} vazio="Selecione o tipo" opcoes={tipos.map(t => ({ valor: t.id, rotulo: t.nome }))} onChange={tipoId => setF({ ...f, tipoId, regularidadeFiscal: tipos.find(t => t.id === tipoId)?.pasta === 'fiscal_trabalhista' })} />
    <Caixa rotulo="Aplicável" marcado={f.aplicavel} onChange={aplicavel => setF({ ...f, aplicavel })} />
    <Caixa rotulo="Conferência manual" marcado={f.conferenciaManual} onChange={conferenciaManual => setF({ ...f, conferenciaManual })} />
    <Caixa rotulo="Regularidade fiscal" marcado={f.regularidadeFiscal} onChange={regularidadeFiscal => setF({ ...f, regularidadeFiscal })} />
    <AreaTexto rotulo="Observação" value={f.observacao} maxLength={500} onChange={observacao => setF({ ...f, observacao })} />
    <Botao type="submit" disabled={!f.tipoId} carregando={enviando}>Salvar exigência</Botao><Botao variante="texto" onClick={cancelar}>Cancelar</Botao>
  </form>
}
