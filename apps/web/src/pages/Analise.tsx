import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { chamar } from '../api/cliente'
import { useEnvio } from '../features/acesso/conta/useEnvio'
import { useAcesso } from '../features/acesso/contexto'
import { useGet } from '../features/acesso/useGet'
import { Matriz } from '../features/analise/Matriz'
import { Requisitos } from '../features/analise/Requisitos'
import type { Dados } from '../features/analise/tipos'
import { Aviso, Botao, CabecalhoPagina, Etiqueta, Pagina, Selecao } from '../ui'

// Análise técnica de um item (Fase 06): requisitos do edital, produto ofertado e matriz de atendimento calculada por código.
export default function Analise() {
  const { id } = useParams()
  const { empresa, pode } = useAcesso()
  const empresaId = empresa?.empresaId ?? null
  const det = useGet<Dados>(empresaId && id ? `/empresas/${empresaId}/participacoes/${id}/analise` : null)
  const [produto, setProduto] = useState('')
  const pedir = useEnvio()
  if (!empresaId || !id) return <p className="py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  if (det.erro) return <p className="py-10 text-center text-sm text-tertiary">Análise não encontrada ou sem permissão.</p>
  if (!det.dados) return <p className="text-sm text-tertiary">Carregando…</p>
  const d = det.dados
  const podeEditar = pode('analises', 'editar')
  const analisados = new Set(d.analises.map((a) => a.produtoId))
  return (
    <Pagina larga>
      <Link to={`/agenda/acompanhamentos/${d.participacao.acompanhamentoId}`}>← Acompanhamento</Link>
      <CabecalhoPagina
        titulo={`Análise técnica · item ${d.participacao.numeroItem ?? ''}`}
        subtitulo={`${d.participacao.orgao ?? ''}${d.participacao.numeroEdital ? ` · edital nº ${d.participacao.numeroEdital}` : ''} · ${d.participacao.descricao ?? ''}`.slice(0, 220)}
        acoes={<Etiqueta cor="aviso">A classificação é feita por código, nunca pela IA</Etiqueta>}
      />
      <Aviso tipo="atencao" texto="ATENDE só aparece com a citação do edital conferida automaticamente e a evidência da ficha técnica conferida por uma pessoa. Sem evidência, o resultado é “A CONFIRMAR”. Obrigatório não atendido reprova o item. A extração automática de requisitos por IA ainda não está ligada: cadastre os requisitos à mão." />
      <Requisitos empresaId={empresaId} d={d} podeEditar={podeEditar} aoMudar={det.recarregar} />
      {podeEditar ? (
        <section className="flex flex-col gap-3 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-prod">
          <h2 id="h-prod">Produto ofertado</h2>
          <Aviso texto={pedir.erro} />
          {d.produtos.length === 0 ? <p className="text-sm text-tertiary">Nenhum produto ativo no catálogo da empresa (Cadastros → Produtos).</p> : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1"><Selecao rotulo="Produto do catálogo" value={produto} onChange={setProduto} vazio="Escolha" opcoes={d.produtos.map((p) => ({ valor: p.id, rotulo: `${p.codigoInterno} · ${[p.marca, p.modelo].filter(Boolean).join(' ')} · ${p.descricao}`.slice(0, 90) }))} /></div>
              <Botao carregando={pedir.enviando} disabled={!produto} onClick={() => void pedir.enviar(async () => { await chamar('POST', `/empresas/${empresaId}/participacoes/${id}/analises`, { produtoId: produto }); setProduto(''); det.recarregar() })}>{analisados.has(produto) ? 'Recalcular análise' : 'Analisar este produto'}</Botao>
            </div>
          )}
        </section>
      ) : null}
      {d.analises.map((a) => <Matriz key={a.id} empresaId={empresaId} d={d} a={a} podeEditar={podeEditar} podeAprovar={pode('analises', 'aprovar')} aoMudar={det.recarregar} />)}
      <div><Botao variante="texto" onClick={det.recarregar}>Atualizar</Botao></div>
    </Pagina>
  )
}
