import { useState } from 'react'
import { chamar } from '../../api/cliente'
import { Aviso, Botao, Campo, Etiqueta, Legenda, Modal, Selecao } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useGet } from '../acesso/useGet'
import { dataHoraSP } from '../agenda/comum'
import { COR_RESULTADO, COR_RESUMO, exigido, type Analise, type Dados, type Linha } from './tipos'

const nomeProduto = (a: Analise) => [a.codigoInterno, a.marca, a.modelo].filter(Boolean).join(' · ') || 'Produto'

// Matriz de um produto: uma linha por requisito, com o resultado calculado POR CÓDIGO (nunca pela IA), a evidência do edital
// (conferida automaticamente) e a da ficha técnica (conferida por uma pessoa). ATENDE só existe com as duas evidências.
export function Matriz({ empresaId, d, a, podeEditar, podeAprovar, aoMudar }: { empresaId: string; d: Dados; a: Analise; podeEditar: boolean; podeAprovar: boolean; aoMudar: () => void }) {
  const { enviando, erro, enviar } = useEnvio()
  const [conferindo, setConferindo] = useState<Linha | null>(null)
  const porRequisito = new Map(a.linhas.map((l) => [l.requisitoId, l]))
  const aprovada = a.aprovadoEm !== null
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-label={`Análise de ${nomeProduto(a)}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 flex-1 [overflow-wrap:anywhere]"><bdi>{nomeProduto(a)}</bdi></h2>
        {a.resumo ? <Etiqueta cor={COR_RESUMO[a.resumo]}>{a.resumo}</Etiqueta> : <Etiqueta cor="cinza">Analisando…</Etiqueta>}
        {aprovada ? <Etiqueta cor="sucesso">Aprovada por {a.aprovadoPor ?? '—'} em {dataHoraSP(a.aprovadoEm)}</Etiqueta> : null}
      </div>
      {a.calculadoEm ? <Legenda>Calculado em {dataHoraSP(a.calculadoEm)}. Mudar um requisito ou o produto recalcula e derruba a aprovação se o resultado mudar.</Legenda> : <Legenda>O cálculo está na fila; atualize em instantes.</Legenda>}
      <Aviso texto={erro} />
      {d.requisitos.length === 0 ? <Legenda>Cadastre os requisitos do edital para ver a matriz.</Legenda> : (
        <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl ring-1 ring-secondary">
          {d.requisitos.map((r) => {
            const l = porRequisito.get(r.id)
            return (
              <div key={r.id} className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="min-w-0 flex-1 text-sm text-primary [overflow-wrap:anywhere]"><bdi>{r.nome}</bdi></strong>
                  {!r.obrigatorio ? <Etiqueta cor="cinza">Opcional</Etiqueta> : null}
                  {l ? <Etiqueta cor={COR_RESULTADO[l.resultado]}>{l.resultado}</Etiqueta> : <Etiqueta cor="cinza">Aguardando</Etiqueta>}
                </div>
                <div className="grid grid-cols-1 gap-1 text-sm text-secondary sm:grid-cols-2">
                  <span>Edital exige: {exigido(r, d.unidades)}</span>
                  <span>Produto oferece: {l?.valorOferecido ?? '—'}</span>
                </div>
                {l ? (
                  <div className="flex flex-col gap-1 text-sm">
                    <span className="flex flex-wrap items-center gap-2 text-tertiary">
                      Edital: {l.citacaoVerificada ? <Etiqueta cor="sucesso">citação conferida{l.paginaEdital ? `, página ${l.paginaEdital}` : ''}</Etiqueta> : <Etiqueta cor="aviso">citação não conferida</Etiqueta>}
                      Ficha técnica: {l.fichaConferidaPor ? <Etiqueta cor="sucesso">conferida por {l.fichaConferidaPor}</Etiqueta> : <Etiqueta cor="aviso">falta conferir</Etiqueta>}
                    </span>
                    {l.fichaTrecho ? <Legenda>Ficha, página {l.fichaPagina}: “<bdi>{l.fichaTrecho}</bdi>”</Legenda> : null}
                    {l.pendencia ? <span className="text-warning-primary [overflow-wrap:anywhere]">Pendência: {l.pendencia}</span> : null}
                    {l.justificativa ? <Legenda>{l.justificativa}</Legenda> : null}
                    {podeEditar && l.resultado !== 'NÃO ATENDE' ? <div><Botao variante="secundario" onClick={() => setConferindo(l)}>{l.fichaConferidaPor ? 'Refazer conferência da ficha' : 'Conferir ficha técnica'}</Botao></div> : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      {podeAprovar ? (
        <div className="flex flex-wrap items-center gap-3">
          <Botao carregando={enviando} disabled={!a.resumo || a.resumo === 'PENDENTE' || aprovada} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/analises/${a.id}/aprovar`); aoMudar() })}>{aprovada ? 'Análise aprovada' : 'Aprovar análise técnica'}</Botao>
          {a.resumo === 'PENDENTE' ? <Legenda>Resolva os “A CONFIRMAR” antes de aprovar.</Legenda> : null}
        </div>
      ) : null}
      {conferindo ? <ConferirFicha empresaId={empresaId} l={conferindo} aoFechar={() => setConferindo(null)} aoSalvar={() => { setConferindo(null); aoMudar() }} /> : null}
    </section>
  )
}

function ConferirFicha({ empresaId, l, aoFechar, aoSalvar }: { empresaId: string; l: Linha; aoFechar: () => void; aoSalvar: () => void }) {
  const docs = useGet<{ id: string; descricao: string }[]>(`/empresas/${empresaId}/documentos`)
  const [f, setF] = useState({ doc: l.fichaDocumentoId ?? '', pagina: l.fichaPagina ? String(l.fichaPagina) : '', trecho: l.fichaTrecho ?? '', ressalva: l.ressalva ?? '' })
  const { enviando, erro, enviar } = useEnvio()
  const valido = f.doc !== '' && Number(f.pagina) >= 1 && f.trecho.trim().length >= 5
  return (
    <Modal aberto titulo="Conferir ficha técnica" aoFechar={aoFechar}>
      <p className="text-sm text-secondary">Abra a ficha técnica oficial, confira o valor e copie o trecho exato. Isto registra que VOCÊ conferiu; a classificação continua sendo calculada pelo sistema.</p>
      <Aviso texto={erro ?? (docs.erro ? 'Não foi possível listar os documentos (sem permissão em Documentos?).' : null)} />
      <Selecao rotulo="Documento (ficha técnica)" value={f.doc} onChange={(v) => setF({ ...f, doc: v })} vazio="Escolha" opcoes={(docs.dados ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao }))} />
      <Campo rotulo="Página da ficha" type="number" min={1} value={f.pagina} onChange={(v) => setF({ ...f, pagina: v })} />
      <Campo rotulo="Trecho exato da ficha" value={f.trecho} onChange={(v) => setF({ ...f, trecho: v })} maxLength={2000} />
      <Campo rotulo="Ressalva (opcional, vira “ATENDE COM RESSALVAS”)" value={f.ressalva} onChange={(v) => setF({ ...f, ressalva: v })} maxLength={500} />
      <div className="flex flex-wrap gap-3">
        <Botao carregando={enviando} disabled={!valido} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/analise-linhas/${l.id}/ficha`, { documentoId: f.doc, pagina: Number(f.pagina), trecho: f.trecho.trim(), ressalva: f.ressalva.trim() || null }); aoSalvar() })}>Registrar conferência</Botao>
        <Botao variante="texto" onClick={aoFechar}>Cancelar</Botao>
      </div>
    </Modal>
  )
}
