import { useState, type FormEvent } from 'react'
import { chamar } from '../../../api/cliente'
import { Aviso, Botao, Campo } from '../../../ui'
import { useEnvio } from '../conta/useEnvio'
import { useGet } from '../useGet'
import { dataBr, Selecao } from './comum'

interface Item { descricao: string; quantidade: string; unidade: string; unidadeId: string }
interface Atestado { id: string; contratante: string; objeto: string; periodoInicio: string | null; periodoFim: string | null; itens: Item[] }
interface Unidade { id: string; simbolo: string; nome: string }
interface Tipo { id: string; slug: string }
interface Doc { id: string; tipoId: string; descricao: string }

// Atestados de capacidade técnica (Fase 03): o arquivo é um documento do tipo "atestado técnico"; aqui ficam
// contratante, objeto, período e as quantidades por item (string decimal, nunca number).
export function Atestados({ empresaId, pode }: { empresaId: string; pode: (acao: string) => boolean }) {
  const lista = useGet<Atestado[]>(`/empresas/${empresaId}/atestados`)
  const tipos = useGet<Tipo[]>('/documentos/tipos')
  const docs = useGet<Doc[]>(`/empresas/${empresaId}/documentos`)
  const unidades = useGet<Unidade[]>('/catalogo/unidades')
  const [novo, setNovo] = useState(false)
  const tipoAtestado = tipos.dados?.find((t) => t.slug === 'atestado_tecnico')?.id
  const candidatos = docs.dados?.filter((d) => d.tipoId === tipoAtestado) ?? []
  if (novo) return <Formulario empresaId={empresaId} docs={candidatos} unidades={unidades.dados ?? []} aoFim={() => { setNovo(false); lista.recarregar() }} />
  return (
    <div className="flex flex-col gap-6">
      <Aviso texto={lista.erro} />
      {pode('cadastrar') ? <div><Botao onClick={() => setNovo(true)}>Novo atestado</Botao></div> : null}
      {lista.dados?.length === 0 ? <p className="px-4 py-10 text-center text-sm text-tertiary">Nenhum atestado cadastrado. Primeiro crie o documento do tipo “Atestado de capacidade técnica” na aba Documentos.</p> : null}
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {lista.dados?.map((a) => (
          <div key={a.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
              <strong><bdi>{a.contratante}</bdi></strong>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]"><bdi>{a.objeto}</bdi> · {dataBr(a.periodoInicio)} a {dataBr(a.periodoFim)}</span>
              {a.itens.map((i, n) => <span key={n} className="text-sm text-tertiary [overflow-wrap:anywhere]"><bdi>{i.descricao}</bdi>: {i.quantidade} {i.unidade}</span>)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Formulario({ empresaId, docs, unidades, aoFim }: { empresaId: string; docs: Doc[]; unidades: Unidade[]; aoFim: () => void }) {
  const vazio: Item = { descricao: '', quantidade: '', unidade: '', unidadeId: unidades[0]?.id ?? '' }
  const [f, setF] = useState({ documentoId: docs[0]?.id ?? '', contratante: '', objeto: '', periodoInicio: '', periodoFim: '' })
  const [itens, setItens] = useState<Item[]>([vazio])
  const { enviando, erro, enviar } = useEnvio()
  const mudar = (n: number, p: Partial<Item>) => setItens(itens.map((x, i) => (i === n ? { ...x, ...p } : x)))
  const salvar = (e: FormEvent) => {
    e.preventDefault()
    return enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/atestados`, {
        documentoId: f.documentoId, contratante: f.contratante.trim(), objeto: f.objeto.trim(),
        periodoInicio: f.periodoInicio || null, periodoFim: f.periodoFim || null,
        itens: itens.map((i) => ({ descricao: i.descricao.trim(), quantidade: i.quantidade.trim().replace(',', '.'), unidadeId: i.unidadeId })),
      })
      aoFim()
    })
  }
  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => void salvar(e)}>
      <h2>Novo atestado técnico</h2>
      {docs.length === 0 ? <Aviso texto="Crie antes um documento do tipo “Atestado de capacidade técnica” na aba Documentos." /> : null}
      <Selecao rotulo="Documento (arquivo do atestado)" value={f.documentoId} onChange={(v) => setF({ ...f, documentoId: v })} opcoes={docs.map((d) => ({ valor: d.id, rotulo: d.descricao }))} />
      <Campo rotulo="Contratante" value={f.contratante} onChange={(v) => setF({ ...f, contratante: v })} maxLength={200} />
      <Campo rotulo="Objeto" value={f.objeto} onChange={(v) => setF({ ...f, objeto: v })} maxLength={1000} />
      <Campo rotulo="Início" type="date" value={f.periodoInicio} onChange={(v) => setF({ ...f, periodoInicio: v })} />
      <Campo rotulo="Fim" type="date" value={f.periodoFim} onChange={(v) => setF({ ...f, periodoFim: v })} />
      <h3>Itens e quantidades</h3>
      {itens.map((i, n) => (
        <div key={n} className="flex flex-col gap-4">
          <Campo rotulo="Descrição do item" value={i.descricao} onChange={(v) => mudar(n, { descricao: v })} maxLength={300} />
          <Campo rotulo="Quantidade" inputMode="decimal" value={i.quantidade} onChange={(v) => mudar(n, { quantidade: v })} />
          <Selecao rotulo="Unidade" value={i.unidadeId} onChange={(v) => mudar(n, { unidadeId: v })} opcoes={unidades.map((u) => ({ valor: u.id, rotulo: `${u.simbolo} · ${u.nome}` }))} />
          {itens.length > 1 ? <Botao variante="texto" onClick={() => setItens(itens.filter((_, k) => k !== n))}>Remover item</Botao> : null}
        </div>
      ))}
      <Botao variante="secundario" onClick={() => setItens([...itens, vazio])}>Adicionar item</Botao>
      <Aviso texto={erro} />
      <Botao type="submit" cheio carregando={enviando} disabled={!f.documentoId}>Salvar atestado</Botao>
      <Botao variante="texto" onClick={aoFim}>Cancelar</Botao>
    </form>
  )
}
