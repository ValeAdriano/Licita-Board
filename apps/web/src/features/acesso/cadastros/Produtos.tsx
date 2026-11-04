import { useState, type FormEvent } from 'react'
import { chamar } from '../../../api/cliente'
import { Aviso, Botao, Campo } from '../../../ui'
import { Secao } from '../conta/Secao'
import { useEnvio } from '../conta/useEnvio'
import { useGet } from '../useGet'
import { dataBr, ouNulo, Selecao } from './comum'

interface Categoria { id: string; slug: string; nome: string; paiId: string | null }
interface Modelo { id: string; fabricante: string; modelo: string; versao: string | null; anoModelo: number | null }
interface AtributoDef { id: string; slug: string; nome: string; tipo: 'numero' | 'texto' | 'lista' | 'booleano'; grandeza: string | null; unidadePadraoId: string | null; unidadePadrao: string | null; opcoes: string[] | null }
interface Unidade { id: string; simbolo: string; grandeza: string }
interface ValorAtributo { atributoId: string; valorNumero: string | null; valorTexto: string | null; valorBooleano: boolean | null; unidadeId: string | null }
interface Produto { id: string; codigoInterno: string; marca: string | null; modelo: string | null; descricao: string; categoriaId: string; modeloId: string | null; statusComercial: string; fornecedor: string | null }
interface Ficha { id: string; versaoFicha: number; fabricante: string; modelo: string; ano: number | null; dataEmissao: string | null; validaAte: string | null; situacao: string }

const STATUS = [{ valor: 'ativo', rotulo: 'Ativo' }, { valor: 'suspenso', rotulo: 'Suspenso' }, { valor: 'descontinuado', rotulo: 'Descontinuado' }]

// Produtos da empresa (Prompt 2.3 e 2.4): atributos técnicos tipados vindos do catálogo, custo e preço de
// referência só para quem tem ver_custos_margens, fichas técnicas versionadas.
export function Produtos({ empresaId, pode }: { empresaId: string; pode: (acao: string) => boolean }) {
  const [busca, setBusca] = useState('')
  const lista = useGet<Produto[]>(`/empresas/${empresaId}/produtos${busca.trim() ? `?q=${encodeURIComponent(busca.trim())}` : ''}`)
  const categorias = useGet<Categoria[]>('/catalogo/categorias')
  const [aberto, setAberto] = useState<string | 'novo' | null>(null)
  const sel = lista.dados?.find((p) => p.id === aberto)
  if (aberto === 'novo' || sel) {
    return <Detalhe key={aberto} empresaId={empresaId} produto={sel ?? null} categorias={categorias.dados ?? []} pode={pode} aoVoltar={() => { setAberto(null); lista.recarregar() }} />
  }
  return (
    <div className="pilha pilha--grande">
      <Campo rotulo="Buscar por código, descrição ou modelo" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <Aviso texto={lista.erro} />
      {pode('cadastrar') ? <div><Botao onClick={() => setAberto('novo')}>Novo produto</Botao></div> : null}
      {lista.dados?.length === 0 ? <p className="vazio">Nenhum produto cadastrado.</p> : null}
      <div className="lista">
        {lista.dados?.map((p) => (
          <button key={p.id} type="button" className="lista__item" onClick={() => setAberto(p.id)}>
            <span className="lista__texto">
              <strong><bdi>{p.codigoInterno}</bdi> · <bdi>{p.descricao}</bdi></strong>
              <span className="legenda">{[p.marca, p.modelo].filter(Boolean).join(' ')} · {categorias.dados?.find((c) => c.id === p.categoriaId)?.nome}</span>
            </span>
            <span className="tag">{STATUS.find((s) => s.valor === p.statusComercial)?.rotulo}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Detalhe({ empresaId, produto, categorias, pode, aoVoltar }: { empresaId: string; produto: Produto | null; categorias: Categoria[]; pode: (acao: string) => boolean; aoVoltar: () => void }) {
  const [f, setF] = useState({
    codigoInterno: produto?.codigoInterno ?? '', descricao: produto?.descricao ?? '', categoriaId: produto?.categoriaId ?? categorias.find((c) => !c.paiId)?.id ?? '',
    modeloId: produto?.modeloId ?? '', marca: produto?.marca ?? '', modelo: produto?.modelo ?? '', fornecedor: produto?.fornecedor ?? '', statusComercial: produto?.statusComercial ?? 'ativo',
  })
  const modelos = useGet<Modelo[]>(f.categoriaId ? `/catalogo/modelos?categoria=${f.categoriaId}` : null)
  const { enviando, erro, ok, enviar } = useEnvio()
  const [id, setId] = useState(produto?.id ?? null)
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  const salvar = (e: FormEvent) => {
    e.preventDefault()
    return enviar(async () => {
      const corpo = { codigoInterno: f.codigoInterno.trim(), descricao: f.descricao.trim(), categoriaId: f.categoriaId, modeloId: f.modeloId || null, marca: ouNulo(f.marca), modelo: ouNulo(f.modelo), fornecedor: ouNulo(f.fornecedor), statusComercial: f.statusComercial }
      if (id) await chamar('PATCH', `/empresas/${empresaId}/produtos/${id}`, corpo)
      else setId((await chamar<{ id: string }>('POST', `/empresas/${empresaId}/produtos`, corpo)).id)
      return 'Produto salvo.'
    })
  }
  return (
    <div className="pilha pilha--grande">
      <Botao variante="texto" onClick={aoVoltar}>← Voltar</Botao>
      <Secao titulo={id ? 'Produto' : 'Novo produto'}>
        <form className="pilha" onSubmit={(e) => void salvar(e)}>
          <Campo rotulo="Código interno" value={f.codigoInterno} onChange={(e) => set('codigoInterno')(e.target.value)} maxLength={60} />
          <Campo rotulo="Descrição" value={f.descricao} onChange={(e) => set('descricao')(e.target.value)} maxLength={2000} />
          <Selecao rotulo="Categoria" value={f.categoriaId} onChange={set('categoriaId')} opcoes={categorias.map((c) => ({ valor: c.id, rotulo: `${c.paiId ? '— ' : ''}${c.nome}` }))} />
          <Selecao rotulo="Modelo do catálogo (opcional)" value={f.modeloId} onChange={set('modeloId')} vazio="Fora do catálogo" opcoes={(modelos.dados ?? []).map((m) => ({ valor: m.id, rotulo: `${m.fabricante} ${m.modelo}${m.versao ? ` ${m.versao}` : ''}${m.anoModelo ? ` (${m.anoModelo})` : ''}` }))} />
          <Campo rotulo="Marca" value={f.marca} onChange={(e) => set('marca')(e.target.value)} maxLength={120} />
          <Campo rotulo="Modelo" value={f.modelo} onChange={(e) => set('modelo')(e.target.value)} maxLength={120} />
          <Campo rotulo="Fornecedor" value={f.fornecedor} onChange={(e) => set('fornecedor')(e.target.value)} maxLength={200} />
          <Selecao rotulo="Status comercial" value={f.statusComercial} onChange={set('statusComercial')} opcoes={STATUS} />
          <Aviso texto={erro} />
          <Aviso tipo="info" texto={ok} />
          {pode(id ? 'editar' : 'cadastrar') ? <Botao type="submit" carregando={enviando}>Salvar produto</Botao> : null}
        </form>
        {id && pode('arquivar') ? <Botao variante="perigo" onClick={() => void chamar('POST', `/empresas/${empresaId}/produtos/${id}/arquivar`).then(aoVoltar)}>Arquivar produto</Botao> : null}
      </Secao>
      {id ? (
        <>
          <Atributos empresaId={empresaId} produtoId={id} categoriaId={f.categoriaId} podeEditar={pode('editar')} />
          {pode('ver_custos_margens') ? <Precos empresaId={empresaId} produtoId={id} /> : null}
          <Fichas empresaId={empresaId} produtoId={id} modelo={f.modelo} marca={f.marca} pode={pode} />
        </>
      ) : null}
    </div>
  )
}

function Atributos({ empresaId, produtoId, categoriaId, podeEditar }: { empresaId: string; produtoId: string; categoriaId: string; podeEditar: boolean }) {
  const defs = useGet<AtributoDef[]>(`/catalogo/atributos?categoria=${categoriaId}`)
  const unidades = useGet<Unidade[]>('/catalogo/unidades')
  const atuais = useGet<ValorAtributo[]>(`/empresas/${empresaId}/produtos/${produtoId}/atributos`)
  const [vals, setVals] = useState<Record<string, ValorAtributo> | null>(null)
  const { enviando, erro, ok, enviar } = useEnvio()
  const atual = vals ?? Object.fromEntries((atuais.dados ?? []).map((a) => [a.atributoId, a]))
  const vazio = (d: AtributoDef): ValorAtributo => ({ atributoId: d.id, valorNumero: null, valorTexto: null, valorBooleano: null, unidadeId: d.unidadePadraoId })
  const mudar = (d: AtributoDef, parte: Partial<ValorAtributo>) => setVals({ ...atual, [d.id]: { ...(atual[d.id] ?? vazio(d)), ...parte } })
  const salvar = () => enviar(async () => {
    const lista = Object.values(atual).filter((v) => v.valorNumero !== null || v.valorTexto !== null || v.valorBooleano !== null).map((v) => v)
    await chamar('PUT', `/empresas/${empresaId}/produtos/${produtoId}/atributos`, { atributos: lista.map((v) => ({ atributoId: v.atributoId, valorNumero: v.valorNumero || null, valorTexto: v.valorTexto || null, valorBooleano: v.valorBooleano, unidadeId: v.unidadeId })) })
    atuais.recarregar()
    return 'Atributos salvos.'
  })
  return (
    <Secao titulo="Atributos técnicos">
      <p className="legenda">Os atributos vêm do catálogo da categoria; cada um tem tipo e unidade padronizados.</p>
      {defs.dados?.length === 0 ? <p className="legenda">Esta categoria ainda não tem atributos no catálogo.</p> : null}
      {defs.dados?.map((d) => {
        const v = atual[d.id] ?? vazio(d)
        if (d.tipo === 'numero') {
          const un = (unidades.dados ?? []).filter((u) => u.grandeza === d.grandeza)
          return (
            <div key={d.id} className="pilha">
              <Campo rotulo={d.nome} inputMode="decimal" value={v.valorNumero ?? ''} disabled={!podeEditar} onChange={(e) => mudar(d, { valorNumero: e.target.value.replace(',', '.') || null })} />
              {un.length ? <Selecao rotulo={`Unidade de ${d.nome}`} value={v.unidadeId ?? ''} onChange={(x) => mudar(d, { unidadeId: x || null })} opcoes={un.map((u) => ({ valor: u.id, rotulo: u.simbolo }))} disabled={!podeEditar} /> : null}
            </div>
          )
        }
        if (d.tipo === 'lista') return <Selecao key={d.id} rotulo={d.nome} value={v.valorTexto ?? ''} vazio="—" disabled={!podeEditar} onChange={(x) => mudar(d, { valorTexto: x || null })} opcoes={(d.opcoes ?? []).map((o) => ({ valor: o, rotulo: o }))} />
        if (d.tipo === 'booleano') return <Selecao key={d.id} rotulo={d.nome} value={v.valorBooleano === null ? '' : String(v.valorBooleano)} vazio="—" disabled={!podeEditar} onChange={(x) => mudar(d, { valorBooleano: x === '' ? null : x === 'true' })} opcoes={[{ valor: 'true', rotulo: 'Sim' }, { valor: 'false', rotulo: 'Não' }]} />
        return <Campo key={d.id} rotulo={d.nome} value={v.valorTexto ?? ''} maxLength={500} disabled={!podeEditar} onChange={(e) => mudar(d, { valorTexto: e.target.value || null })} />
      })}
      <Aviso texto={erro ?? defs.erro} />
      <Aviso tipo="info" texto={ok} />
      {podeEditar ? <Botao carregando={enviando} onClick={() => void salvar()}>Salvar atributos</Botao> : null}
    </Secao>
  )
}

function Precos({ empresaId, produtoId }: { empresaId: string; produtoId: string }) {
  const p = useGet<{ precoCusto: string | null; precoReferencia: string | null }>(`/empresas/${empresaId}/produtos/${produtoId}/precos`)
  if (!p.dados) return null
  return <PrecosForm key={`${p.dados.precoCusto}|${p.dados.precoReferencia}`} empresaId={empresaId} produtoId={produtoId} inicial={p.dados} aoSalvar={p.recarregar} />
}
function PrecosForm({ empresaId, produtoId, inicial, aoSalvar }: { empresaId: string; produtoId: string; inicial: { precoCusto: string | null; precoReferencia: string | null }; aoSalvar: () => void }) {
  const [custo, setCusto] = useState(inicial.precoCusto ?? '')
  const [ref, setRef] = useState(inicial.precoReferencia ?? '')
  const { enviando, erro, ok, enviar } = useEnvio()
  return (
    <Secao titulo="Custo e preço de referência">
      <p className="legenda">Só quem tem a permissão de ver custos e margens enxerga esta área. Valores em reais (R$), com ponto decimal.</p>
      <Campo rotulo="Preço de custo (R$)" inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value.replace(',', '.'))} />
      <Campo rotulo="Preço de referência (R$)" inputMode="decimal" value={ref} onChange={(e) => setRef(e.target.value.replace(',', '.'))} />
      <Aviso texto={erro} />
      <Aviso tipo="info" texto={ok} />
      <Botao carregando={enviando} onClick={() => void enviar(async () => { await chamar('PUT', `/empresas/${empresaId}/produtos/${produtoId}/precos`, { precoCusto: custo || null, precoReferencia: ref || null }); aoSalvar(); return 'Valores salvos.' })}>Salvar valores</Botao>
    </Secao>
  )
}

function Fichas({ empresaId, produtoId, modelo, marca, pode }: { empresaId: string; produtoId: string; modelo: string; marca: string; pode: (acao: string) => boolean }) {
  const lista = useGet<Ficha[]>(`/empresas/${empresaId}/produtos/${produtoId}/fichas`)
  const [f, setF] = useState({ fabricante: marca, modelo, ano: '', emissao: '', valida: '', fonte: '' })
  const { enviando, erro, enviar } = useEnvio()
  const incluir = (e: FormEvent) => {
    e.preventDefault()
    return enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/produtos/${produtoId}/fichas`, { fabricante: f.fabricante.trim(), modelo: f.modelo.trim(), ano: f.ano ? Number(f.ano) : null, dataEmissao: f.emissao || null, validaAte: f.valida || null, fonteOficial: ouNulo(f.fonte) })
      lista.recarregar()
    })
  }
  return (
    <Secao titulo="Fichas técnicas (histórico)">
      <p className="legenda">Nova ficha vira a versão vigente e preserva as anteriores.</p>
      <div className="lista">
        {lista.dados?.map((x) => (
          <div key={x.id} className="lista__item" style={{ cursor: 'default' }}>
            <span className="lista__texto">
              <strong>Versão {x.versaoFicha} · {x.fabricante} {x.modelo}{x.ano ? ` (${x.ano})` : ''}</strong>
              <span className="legenda">Emitida em {dataBr(x.dataEmissao)} · válida até {dataBr(x.validaAte)}</span>
            </span>
            <span className="tag">{x.situacao}</span>
          </div>
        ))}
      </div>
      {pode('cadastrar') ? (
        <form className="pilha" onSubmit={(e) => void incluir(e)}>
          <Campo rotulo="Fabricante" value={f.fabricante} onChange={(e) => setF({ ...f, fabricante: e.target.value })} maxLength={120} />
          <Campo rotulo="Modelo" value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} maxLength={120} />
          <Campo rotulo="Ano" inputMode="numeric" value={f.ano} onChange={(e) => setF({ ...f, ano: e.target.value })} maxLength={4} />
          <Campo rotulo="Data de emissão" type="date" value={f.emissao} onChange={(e) => setF({ ...f, emissao: e.target.value })} />
          <Campo rotulo="Válida até" type="date" value={f.valida} onChange={(e) => setF({ ...f, valida: e.target.value })} />
          <Campo rotulo="Fonte oficial (link ou descrição)" value={f.fonte} onChange={(e) => setF({ ...f, fonte: e.target.value })} maxLength={300} />
          <Aviso texto={erro} />
          <Botao type="submit" variante="secundario" carregando={enviando}>Registrar nova versão da ficha</Botao>
        </form>
      ) : null}
    </Secao>
  )
}
