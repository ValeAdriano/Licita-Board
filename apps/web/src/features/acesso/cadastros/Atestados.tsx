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
    <div className="pilha pilha--grande">
      <Aviso texto={lista.erro} />
      {pode('cadastrar') ? <div><Botao onClick={() => setNovo(true)}>Novo atestado</Botao></div> : null}
      {lista.dados?.length === 0 ? <p className="vazio">Nenhum atestado cadastrado. Primeiro crie o documento do tipo “Atestado de capacidade técnica” na aba Documentos.</p> : null}
      <div className="lista">
        {lista.dados?.map((a) => (
          <div key={a.id} className="lista__item" style={{ cursor: 'default' }}>
            <span className="lista__texto">
              <strong><bdi>{a.contratante}</bdi></strong>
              <span className="legenda"><bdi>{a.objeto}</bdi> · {dataBr(a.periodoInicio)} a {dataBr(a.periodoFim)}</span>
              {a.itens.map((i, n) => <span key={n} className="legenda"><bdi>{i.descricao}</bdi>: {i.quantidade} {i.unidade}</span>)}
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
    <form className="pilha pilha--grande" onSubmit={(e) => void salvar(e)}>
      <h2>Novo atestado técnico</h2>
      {docs.length === 0 ? <Aviso texto="Crie antes um documento do tipo “Atestado de capacidade técnica” na aba Documentos." /> : null}
      <Selecao rotulo="Documento (arquivo do atestado)" value={f.documentoId} onChange={(v) => setF({ ...f, documentoId: v })} opcoes={docs.map((d) => ({ valor: d.id, rotulo: d.descricao }))} />
      <Campo rotulo="Contratante" value={f.contratante} onChange={(e) => setF({ ...f, contratante: e.target.value })} maxLength={200} />
      <Campo rotulo="Objeto" value={f.objeto} onChange={(e) => setF({ ...f, objeto: e.target.value })} maxLength={1000} />
      <Campo rotulo="Início" type="date" value={f.periodoInicio} onChange={(e) => setF({ ...f, periodoInicio: e.target.value })} />
      <Campo rotulo="Fim" type="date" value={f.periodoFim} onChange={(e) => setF({ ...f, periodoFim: e.target.value })} />
      <h3>Itens e quantidades</h3>
      {itens.map((i, n) => (
        <div key={n} className="pilha">
          <Campo rotulo="Descrição do item" value={i.descricao} onChange={(e) => mudar(n, { descricao: e.target.value })} maxLength={300} />
          <Campo rotulo="Quantidade" inputMode="decimal" value={i.quantidade} onChange={(e) => mudar(n, { quantidade: e.target.value })} />
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
