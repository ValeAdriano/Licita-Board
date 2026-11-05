import { useState } from 'react'
import { Link } from 'react-router'
import { Aviso, Campo, Etiqueta, Legenda, Selecao, Vazio } from '../../ui'
import { useGet } from '../acesso/useGet'
import { dataSP } from '../agenda/comum'
import { reais } from '../precos/formato'
import { COR_RESULTADO, HABILITACAO, RESULTADO } from './tipos'

interface Linha {
  id: string; participacaoId: string; acompanhamentoId: string; resultado: string; valorInicial: string | null; valorFinal: string | null; classificacao: number | null; melhorLance: string | null
  vencedoraNome: string | null; vencedoraCnpj: string | null; vencedoraMarcaModelo: string | null; motivo: string | null; habilitacao: string; ocorridoEm: string; gatilhoRecursal: boolean
  numeroItem: number | null; item: string | null; numeroEdital: string | null; processo: string | null; objeto: string | null; orgao: string | null; uf: string | null; municipio: string | null; marca: string | null; modelo: string | null
}

// Histórico de participações e resultados (9.4): pesquisável por texto, órgão, marca/modelo, ano e situação.
export function Historico({ empresaId }: { empresaId: string }) {
  const [f, setF] = useState({ q: '', orgao: '', marca: '', ano: '', status: '' })
  const qs = [f.q && `q=${encodeURIComponent(f.q)}`, f.orgao && `orgao=${encodeURIComponent(f.orgao)}`, f.marca && `marca=${encodeURIComponent(f.marca)}`, f.ano && `ano=${f.ano}`, f.status && `status=${f.status}`].filter(Boolean).join('&')
  const lista = useGet<Linha[]>(`/empresas/${empresaId}/resultados${qs ? `?${qs}` : ''}`)
  const ganhas = (lista.dados ?? []).filter((l) => ['adjudicada', 'homologada', 'contratada'].includes(l.resultado)).length
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Campo rotulo="Buscar (órgão, objeto, edital, vencedora…)" value={f.q} onChange={(v) => setF({ ...f, q: v })} maxLength={100} />
        <Campo rotulo="Órgão ou município" value={f.orgao} onChange={(v) => setF({ ...f, orgao: v })} maxLength={100} />
        <Campo rotulo="Marca ou modelo" value={f.marca} onChange={(v) => setF({ ...f, marca: v })} maxLength={100} />
        <Campo rotulo="Ano" type="number" min={2000} max={2100} value={f.ano} onChange={(v) => setF({ ...f, ano: v })} />
        <Selecao rotulo="Resultado" value={f.status} onChange={(v) => setF({ ...f, status: v })} vazio="Todos" opcoes={Object.entries(RESULTADO).map(([valor, rotulo]) => ({ valor, rotulo }))} />
      </div>
      <Aviso texto={lista.erro} />
      {lista.carregando ? <p className="text-sm text-tertiary">Carregando…</p> : null}
      {!lista.carregando && (lista.dados ?? []).length === 0 ? <Vazio>Nenhum resultado registrado com estes filtros. Registre o resultado de cada item na tela do acompanhamento.</Vazio> : <Legenda>{lista.dados?.length} resultado(s) · {ganhas} ganho(s) (adjudicado, homologado ou contratado)</Legenda>}
      <div className="flex flex-col gap-2">
        {(lista.dados ?? []).map((l) => (
          <Link key={l.id} to={`/agenda/acompanhamentos/${l.acompanhamentoId}`} className="flex flex-col gap-2 rounded-xl bg-primary p-4 no-underline shadow-xs ring-1 ring-secondary hover:bg-primary_hover">
            <span className="flex flex-wrap items-center gap-2">
              <strong className="text-md text-primary [overflow-wrap:anywhere]"><bdi>{l.orgao ?? '—'}</bdi></strong>
              <Etiqueta cor={COR_RESULTADO[l.resultado] ?? 'cinza'}>{RESULTADO[l.resultado] ?? l.resultado}</Etiqueta>
              {l.gatilhoRecursal ? <Etiqueta cor="aviso">Intenção de recurso na agenda</Etiqueta> : null}
              <Etiqueta cor="cinza">Habilitação: {HABILITACAO[l.habilitacao] ?? l.habilitacao}</Etiqueta>
            </span>
            <span className="text-sm text-secondary [overflow-wrap:anywhere]">{l.numeroEdital ? `Edital nº ${l.numeroEdital} · ` : ''}{l.processo ? `processo ${l.processo} · ` : ''}item {l.numeroItem ?? '—'} · <bdi>{l.item ?? l.objeto}</bdi></span>
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-tertiary">
              <span>{l.municipio ?? '—'}/{l.uf ?? '—'}</span>
              <span>{dataSP(l.ocorridoEm)}</span>
              <span>Nosso final {reais(l.valorFinal)}</span>
              <span>Melhor lance {reais(l.melhorLance)}</span>
              <span>Classificação {l.classificacao ?? '—'}</span>
              {l.marca ? <span>Ofertado: <bdi>{l.marca} {l.modelo ?? ''}</bdi></span> : null}
              {l.vencedoraNome ? <span>Vencedora: <bdi>{l.vencedoraNome}</bdi>{l.vencedoraMarcaModelo ? ` (${l.vencedoraMarcaModelo})` : ''}</span> : null}
              {l.motivo ? <span>Motivo: <bdi>{l.motivo}</bdi></span> : null}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
