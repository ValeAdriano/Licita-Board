import { useState } from 'react'
import { chamar } from '../../api/cliente'
import { AreaTexto, Aviso, Botao, Campo, Etiqueta, Legenda, Selecao, Vazio } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { exigido, OPERADOR, TIPO_EXIGENCIA, type Dados } from './tipos'

const VAZIO = { nome: '', tipo: 'minimo', atributoId: '', operador: '>=', numero: '', max: '', texto: '', unidadeId: '', obrigatorio: 'sim', citacao: '', pagina: '' }

// O que o edital exige para este item. Cada requisito leva a citação literal e a página: o sistema confere se o trecho
// existe no texto do edital (se não existir, o requisito não vira ATENDE). Texto de edital é dado, nunca instrução.
export function Requisitos({ empresaId, d, podeEditar, aoMudar }: { empresaId: string; d: Dados; podeEditar: boolean; aoMudar: () => void }) {
  const [f, setF] = useState(VAZIO)
  const { enviando, erro, enviar } = useEnvio()
  const numerico = ['>=', '<=', '=', 'entre'].includes(f.operador)
  const valido = f.nome.trim().length >= 2 && (!numerico || /^-?\d+([.,]\d+)?$/.test(f.numero.trim())) && (f.operador !== 'entre' || /^-?\d+([.,]\d+)?$/.test(f.max.trim())) && (f.operador !== 'contem' || f.texto.trim() !== '')
  const dec = (v: string) => v.trim().replace(',', '.')
  const salvar = () =>
    enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/participacoes/${d.participacao.id}/requisitos`, {
        nome: f.nome.trim(), tipo: f.tipo, atributoId: f.atributoId || null, operador: f.operador, valorNumero: numerico && f.numero ? dec(f.numero) : null,
        valorMax: f.operador === 'entre' ? dec(f.max) : null, valorTexto: f.texto.trim() || null, unidadeId: f.unidadeId || null, obrigatorio: f.obrigatorio === 'sim',
        citacaoEdital: f.citacao.trim() || null, pagina: f.pagina ? Number(f.pagina) : null,
      })
      setF(VAZIO)
      aoMudar()
    })
  const remover = (id: string) => enviar(async () => { await chamar('DELETE', `/empresas/${empresaId}/requisitos/${id}`); aoMudar() })
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-req">
      <h2 id="h-req">Requisitos do edital ({d.requisitos.length})</h2>
      <Legenda>Um requisito por exigência técnica do item. Vincule ao atributo do catálogo para o sistema comparar com o produto (garantia e prazo de entrega usam o cadastro do produto).</Legenda>
      <Aviso texto={erro} />
      {d.requisitos.length === 0 ? <Vazio>Nenhum requisito cadastrado ainda.</Vazio> : (
        <ul className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl ring-1 ring-secondary">
          {d.requisitos.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-3 p-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2"><strong className="text-sm text-primary [overflow-wrap:anywhere]"><bdi>{r.nome}</bdi></strong>
                  <Etiqueta cor={r.obrigatorio ? 'marca' : 'cinza'}>{r.obrigatorio ? 'Obrigatório' : 'Opcional'}</Etiqueta><Etiqueta cor="cinza">{TIPO_EXIGENCIA[r.tipo] ?? r.tipo}</Etiqueta></span>
                <span className="text-sm text-secondary">Exige: {exigido(r, d.unidades)}{r.atributoId ? ` · atributo ${d.atributos.find((a) => a.id === r.atributoId)?.nome ?? ''}` : ''}</span>
                {r.citacaoEdital ? <Legenda>“<bdi>{r.citacaoEdital}</bdi>”{r.pagina ? ` · página ${r.pagina}` : ''}</Legenda> : <Legenda>Sem citação do edital: o resultado nunca passa de “A CONFIRMAR”.</Legenda>}
              </div>
              {podeEditar ? <Botao variante="texto" disabled={enviando} onClick={() => void remover(r.id)}>Remover</Botao> : null}
            </li>
          ))}
        </ul>
      )}
      {podeEditar ? (
        <div className="flex flex-col gap-3 rounded-xl bg-secondary p-4">
          <h3 className="text-sm font-semibold text-secondary">Novo requisito</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo rotulo="Nome do requisito" value={f.nome} onChange={(v) => setF({ ...f, nome: v })} maxLength={200} />
            <Selecao rotulo="Tipo" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} opcoes={Object.entries(TIPO_EXIGENCIA).map(([valor, rotulo]) => ({ valor, rotulo }))} />
            <Selecao rotulo="Atributo do catálogo" value={f.atributoId} onChange={(v) => setF({ ...f, atributoId: v })} vazio="Nenhum (garantia/prazo usam o produto)" opcoes={d.atributos.map((a) => ({ valor: a.id, rotulo: `${a.nome} (${a.categoria})` }))} />
            <Selecao rotulo="Comparação" value={f.operador} onChange={(v) => setF({ ...f, operador: v })} opcoes={Object.entries(OPERADOR).map(([valor, rotulo]) => ({ valor, rotulo }))} />
            {numerico ? <Campo rotulo={f.operador === 'entre' ? 'De' : 'Valor'} inputMode="decimal" value={f.numero} onChange={(v) => setF({ ...f, numero: v })} dica="Use ponto ou vírgula." /> : null}
            {f.operador === 'entre' ? <Campo rotulo="Até" inputMode="decimal" value={f.max} onChange={(v) => setF({ ...f, max: v })} /> : null}
            {numerico ? <Selecao rotulo="Unidade" value={f.unidadeId} onChange={(v) => setF({ ...f, unidadeId: v })} vazio="Sem unidade (contagem)" opcoes={d.unidades.map((u) => ({ valor: u.id, rotulo: `${u.simbolo} (${u.grandeza})` }))} /> : null}
            {f.operador === 'contem' || f.operador === '=' ? <Campo rotulo="Texto exigido" value={f.texto} onChange={(v) => setF({ ...f, texto: v })} maxLength={500} /> : null}
            <Selecao rotulo="Obrigatório?" value={f.obrigatorio} onChange={(v) => setF({ ...f, obrigatorio: v })} opcoes={[{ valor: 'sim', rotulo: 'Sim' }, { valor: 'nao', rotulo: 'Não, é opcional' }]} />
            <Campo rotulo="Página do edital (opcional)" type="number" min={1} value={f.pagina} onChange={(v) => setF({ ...f, pagina: v })} />
          </div>
          <AreaTexto rotulo="Citação literal do edital (copie o trecho exato)" value={f.citacao} onChange={(v) => setF({ ...f, citacao: v })} maxLength={2000} />
          <div><Botao carregando={enviando} disabled={!valido} onClick={() => void salvar()}>Adicionar requisito</Botao></div>
        </div>
      ) : null}
    </section>
  )
}
