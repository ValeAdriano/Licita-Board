import { useState, type FormEvent } from 'react'
import { chamar } from '../../../api/cliente'
import { Aviso, Botao, Campo } from '../../../ui'
import { Secao } from '../conta/Secao'
import { useEnvio } from '../conta/useEnvio'
import { useGet } from '../useGet'
import { Caixa, Selecao } from './comum'

interface Categoria { id: string; slug: string; nome: string; paiId: string | null }
interface Unidade { id: string; simbolo: string; nome: string; grandeza: string }
interface Atributo { id: string; slug: string; nome: string; tipo: string; unidadePadrao: string | null }

// Catálogo técnico (só SUPERADMIN escreve; a RLS do banco recusa os demais). Atributo novo é uma linha:
// aparece na hora no cadastro de produtos de qualquer empresa, sem migration.
export function Catalogo() {
  const categorias = useGet<Categoria[]>('/catalogo/categorias')
  const unidades = useGet<Unidade[]>('/catalogo/unidades')
  const [cat, setCat] = useState('')
  const atributos = useGet<Atributo[]>(cat ? `/catalogo/atributos?categoria=${cat}` : null)
  return (
    <div className="flex flex-col gap-6">
      <Aviso texto={categorias.erro} />
      <Selecao rotulo="Categoria" value={cat} onChange={setCat} vazio="Escolha uma categoria" opcoes={(categorias.dados ?? []).map((c) => ({ valor: c.id, rotulo: `${c.paiId ? '— ' : ''}${c.nome}` }))} />
      {cat ? (
        <Secao titulo="Atributos da categoria">
          <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
            {atributos.dados?.map((a) => (
              <div key={a.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]"><strong>{a.nome}</strong><span className="legenda">{a.slug} · {a.tipo}{a.unidadePadrao ? ` · ${a.unidadePadrao}` : ''}</span></span>
              </div>
            ))}
          </div>
          <NovoAtributo categoriaId={cat} unidades={unidades.dados ?? []} aoCriar={atributos.recarregar} />
        </Secao>
      ) : null}
      <NovoModelo categorias={categorias.dados ?? []} />
      <Conversor unidades={unidades.dados ?? []} />
    </div>
  )
}

function NovoAtributo({ categoriaId, unidades, aoCriar }: { categoriaId: string; unidades: Unidade[]; aoCriar: () => void }) {
  const [f, setF] = useState({ slug: '', nome: '', tipo: 'texto', unidadeId: '', opcoes: '', obrigatorio: false })
  const { enviando, erro, ok, enviar } = useEnvio()
  const un = unidades.find((u) => u.id === f.unidadeId)
  const criar = (e: FormEvent) => {
    e.preventDefault()
    return enviar(async () => {
      await chamar('POST', '/catalogo/atributos', {
        categoriaId, slug: f.slug.trim(), nome: f.nome.trim(), tipo: f.tipo, obrigatorio: f.obrigatorio,
        ...(f.tipo === 'numero' && un ? { grandeza: un.grandeza, unidadePadraoId: un.id } : {}),
        ...(f.tipo === 'lista' ? { opcoes: f.opcoes.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
      })
      setF({ slug: '', nome: '', tipo: 'texto', unidadeId: '', opcoes: '', obrigatorio: false })
      aoCriar()
      return 'Atributo criado.'
    })
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void criar(e)}>
      <h3>Novo atributo</h3>
      <Campo rotulo="Identificador (minúsculas e _)" value={f.slug} onChange={(v) => setF({ ...f, slug: v })} maxLength={60} />
      <Campo rotulo="Nome" value={f.nome} onChange={(v) => setF({ ...f, nome: v })} maxLength={120} />
      <Selecao rotulo="Tipo" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} opcoes={[{ valor: 'texto', rotulo: 'Texto' }, { valor: 'numero', rotulo: 'Número' }, { valor: 'lista', rotulo: 'Lista' }, { valor: 'booleano', rotulo: 'Sim/não' }]} />
      {f.tipo === 'numero' ? <Selecao rotulo="Unidade padrão (define a grandeza)" value={f.unidadeId} onChange={(v) => setF({ ...f, unidadeId: v })} vazio="Sem unidade" opcoes={unidades.map((u) => ({ valor: u.id, rotulo: `${u.simbolo} (${u.grandeza})` }))} /> : null}
      {f.tipo === 'lista' ? <Campo rotulo="Opções separadas por vírgula" value={f.opcoes} onChange={(v) => setF({ ...f, opcoes: v })} /> : null}
      <Caixa rotulo="Obrigatório" marcado={f.obrigatorio} onChange={(v) => setF({ ...f, obrigatorio: v })} />
      <Aviso texto={erro} />
      <Aviso tipo="info" texto={ok} />
      <Botao type="submit" variante="secundario" carregando={enviando}>Criar atributo</Botao>
    </form>
  )
}

function NovoModelo({ categorias }: { categorias: Categoria[] }) {
  const [f, setF] = useState({ categoriaId: '', fabricante: '', modelo: '', versao: '', ano: '' })
  const { enviando, erro, ok, enviar } = useEnvio()
  return (
    <Secao titulo="Novo modelo técnico (compartilhado, sem preço)">
      <Selecao rotulo="Categoria" value={f.categoriaId} onChange={(v) => setF({ ...f, categoriaId: v })} vazio="Escolha" opcoes={categorias.map((c) => ({ valor: c.id, rotulo: c.nome }))} />
      <Campo rotulo="Fabricante" value={f.fabricante} onChange={(v) => setF({ ...f, fabricante: v })} maxLength={120} />
      <Campo rotulo="Modelo" value={f.modelo} onChange={(v) => setF({ ...f, modelo: v })} maxLength={120} />
      <Campo rotulo="Versão" value={f.versao} onChange={(v) => setF({ ...f, versao: v })} maxLength={120} />
      <Campo rotulo="Ano do modelo" inputMode="numeric" value={f.ano} onChange={(v) => setF({ ...f, ano: v })} maxLength={4} />
      <Aviso texto={erro} />
      <Aviso tipo="info" texto={ok} />
      <Botao carregando={enviando} disabled={!f.categoriaId} onClick={() => void enviar(async () => {
        await chamar('POST', '/catalogo/modelos', { categoriaId: f.categoriaId, fabricante: f.fabricante.trim(), modelo: f.modelo.trim(), versao: f.versao.trim() || null, anoModelo: f.ano ? Number(f.ano) : null })
        return 'Modelo criado.'
      })}>Criar modelo</Botao>
    </Secao>
  )
}

function Conversor({ unidades }: { unidades: Unidade[] }) {
  const [v, setV] = useState('1')
  const [de, setDe] = useState('kW')
  const [para, setPara] = useState('cv')
  const [r, setR] = useState<string | null>(null)
  const { erro, enviar } = useEnvio()
  const op = unidades.map((u) => ({ valor: u.simbolo, rotulo: `${u.simbolo} (${u.grandeza})` }))
  return (
    <Secao titulo="Conversor de unidades (exato, em decimal)">
      <Campo rotulo="Valor" inputMode="decimal" value={v} onChange={(v) => setV(v.replace(',', '.'))} />
      <Selecao rotulo="De" value={de} onChange={setDe} opcoes={op} />
      <Selecao rotulo="Para" value={para} onChange={setPara} opcoes={op} />
      <Aviso texto={erro} />
      <Botao variante="secundario" onClick={() => void enviar(async () => { const x = await chamar<{ valor: string }>('GET', `/catalogo/converter?valor=${encodeURIComponent(v)}&de=${encodeURIComponent(de)}&para=${encodeURIComponent(para)}`); setR(x.valor) })}>Converter</Botao>
      {r ? <p><strong>{v} {de} = {r} {para}</strong></p> : null}
    </Secao>
  )
}
