import { useState } from 'react'
import { chamar } from '../../api/cliente'
import { Aviso, Botao, Campo, Etiqueta, Modal, Selecao } from '../../ui'
import { useAcesso } from '../acesso/contexto'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useGet } from '../acesso/useGet'
import { ehDecimal, paraDecimal, reais } from '../precos/formato'
import { ABRE_RECURSO, HABILITACAO, RESULTADO, type ResultadoItem } from './tipos'

interface HistoricoSugerido {
  itemId: string
  descricao: string
  resultadosDoItem: {
    id: string
    fornecedorTipo: string
    fornecedorCnpj: string | null
    fornecedorNome: string | null
    marca: string | null
    modelo: string | null
    valorUnitario: string | null
    classificacao: number | null
  }[]
}

// Registro do resultado de um item. Só REGISTRO: o sistema nunca dá lance nem protocola. Arrematada não é homologada: são resultados diferentes.
export function RegistrarResultado({ empresaId, participacaoId, aoFechar, aoSalvar }: { empresaId: string; participacaoId: string; aoFechar: () => void; aoSalvar: () => void }) {
  const atual = useGet<ResultadoItem | Record<string, never>>(`/empresas/${empresaId}/participacoes/${participacaoId}/resultado`)
  if (!atual.dados && !atual.erro) return <Modal aberto titulo="Resultado do item" aoFechar={aoFechar}><p className="text-sm text-tertiary">Carregando…</p></Modal>
  const r = atual.dados && 'resultado' in atual.dados ? (atual.dados as ResultadoItem) : null
  return <Formulario empresaId={empresaId} participacaoId={participacaoId} r={r} aoFechar={aoFechar} aoSalvar={aoSalvar} />
}

function Formulario({ empresaId, participacaoId, r, aoFechar, aoSalvar }: { empresaId: string; participacaoId: string; r: ResultadoItem | null; aoFechar: () => void; aoSalvar: () => void }) {
  const { pode } = useAcesso()
  const sug = useGet<HistoricoSugerido>(pode('editais', 'visualizar') ? `/empresas/${empresaId}/participacoes/${participacaoId}/historico-sugerido` : null)
  const primeiroPncp = sug.dados?.resultadosDoItem?.[0] ?? null
  const dec = (v: string | null) => (v ? v.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace('.', ',') : '')
  const [f, setF] = useState({
    resultado: r?.resultado ?? 'arrematada', inicial: dec(r?.valorInicial ?? null), final: dec(r?.valorFinal ?? null), lance: dec(r?.melhorLance ?? null), classificacao: String(r?.classificacao ?? ''),
    cnpj: r?.vencedoraCnpj ?? '', nome: r?.vencedoraNome ?? '', marca: r?.vencedoraMarcaModelo ?? '', motivo: r?.motivo ?? '', habilitacao: r?.habilitacao ?? 'a_confirmar',
  })
  const { enviando, erro, enviar } = useEnvio()
  const vazioOuDec = (v: string) => v.trim() === '' || ehDecimal(v)
  const precisaMotivo = ABRE_RECURSO.has(f.resultado)
  const valido = vazioOuDec(f.inicial) && vazioOuDec(f.final) && vazioOuDec(f.lance) && (!precisaMotivo || f.motivo.trim().length >= 5)
  const d = (v: string) => (v.trim() === '' ? null : paraDecimal(v))
  return (
    <Modal aberto titulo="Resultado do item" aoFechar={aoFechar}>
      <p className="text-sm text-secondary">Registre o que aconteceu no portal. O sistema não dá lance nem protocola nada. Arrematada e homologada são resultados diferentes.</p>
      {primeiroPncp ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary p-3 text-xs">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-primary">Resultado público no PNCP: {primeiroPncp.fornecedorNome ?? 'Fornecedor'} · {reais(primeiroPncp.valorUnitario, 4)}</span>
            <span className="text-tertiary"><Etiqueta cor="cinza">dado público de referência</Etiqueta></span>
          </div>
          <Botao
            variante="secundario"
            onClick={() => setF({
              ...f,
              cnpj: primeiroPncp.fornecedorCnpj ?? f.cnpj,
              nome: primeiroPncp.fornecedorNome ?? f.nome,
              marca: [primeiroPncp.marca, primeiroPncp.modelo].filter(Boolean).join(' ') || f.marca,
              lance: primeiroPncp.valorUnitario ? dec(primeiroPncp.valorUnitario) : f.lance,
            })}
          >
            Usar sugestão do PNCP
          </Botao>
        </div>
      ) : null}
      {precisaMotivo || Number(f.classificacao) > 1 ? <Aviso tipo="atencao" texto="Perder, ser inabilitada ou desclassificada (ou não ficar em 1º lugar) abre o evento “Intenção de recurso” na Agenda, com prazo calculado pelas regras (⚖️ ainda não validadas pelo jurídico). A decisão de recorrer é sua." /> : null}
      <Aviso texto={erro} />
      <Selecao rotulo="Resultado" value={f.resultado} onChange={(v) => setF({ ...f, resultado: v })} opcoes={Object.entries(RESULTADO).map(([valor, rotulo]) => ({ valor, rotulo }))} />
      <Campo rotulo="Valor inicial ofertado (R$)" inputMode="decimal" value={f.inicial} onChange={(v) => setF({ ...f, inicial: v })} erro={!vazioOuDec(f.inicial)} />
      <Campo rotulo="Valor final ofertado (R$)" inputMode="decimal" value={f.final} onChange={(v) => setF({ ...f, final: v })} erro={!vazioOuDec(f.final)} />
      <Campo rotulo="Melhor lance conhecido (R$)" inputMode="decimal" value={f.lance} onChange={(v) => setF({ ...f, lance: v })} erro={!vazioOuDec(f.lance)} />
      <Campo rotulo="Classificação (1 = primeiro lugar)" type="number" min={1} value={f.classificacao} onChange={(v) => setF({ ...f, classificacao: v })} />
      <Campo rotulo="Empresa vencedora: CNPJ" value={f.cnpj} onChange={(v) => setF({ ...f, cnpj: v })} maxLength={30} />
      <Campo rotulo="Empresa vencedora: nome" value={f.nome} onChange={(v) => setF({ ...f, nome: v })} maxLength={200} />
      <Campo rotulo="Marca e modelo da vencedora" value={f.marca} onChange={(v) => setF({ ...f, marca: v })} maxLength={200} />
      <Selecao rotulo="Situação da habilitação" value={f.habilitacao} onChange={(v) => setF({ ...f, habilitacao: v })} opcoes={Object.entries(HABILITACAO).map(([valor, rotulo]) => ({ valor, rotulo }))} />
      <Campo rotulo={precisaMotivo ? 'Motivo (obrigatório)' : 'Motivo (se perdeu)'} value={f.motivo} onChange={(v) => setF({ ...f, motivo: v })} maxLength={1000} erro={precisaMotivo && f.motivo.trim().length < 5} />
      <div className="flex flex-wrap gap-3">
        <Botao carregando={enviando} disabled={!valido} onClick={() => void enviar(async () => {
          await chamar('POST', `/empresas/${empresaId}/participacoes/${participacaoId}/resultado`, {
            resultado: f.resultado, valorInicial: d(f.inicial), valorFinal: d(f.final), melhorLance: d(f.lance), classificacao: f.classificacao ? Number(f.classificacao) : null,
            vencedoraCnpj: f.cnpj.trim() || null, vencedoraNome: f.nome.trim() || null, vencedoraMarcaModelo: f.marca.trim() || null, motivo: f.motivo.trim() || null, habilitacao: f.habilitacao,
          })
          aoSalvar()
        })}>Registrar resultado</Botao>
        <Botao variante="texto" onClick={aoFechar}>Cancelar</Botao>
      </div>
    </Modal>
  )
}
