import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { chamar } from '../api/cliente'
import { useEnvio } from '../features/acesso/conta/useEnvio'
import { useAcesso } from '../features/acesso/contexto'
import { useGet } from '../features/acesso/useGet'
import { dataHoraSP } from '../features/agenda/comum'
import { LEITURA } from '../features/juridico/Recursos'
import { AreaTexto, Aviso, Botao, CabecalhoPagina, Campo, Cartao, Etiqueta, Legenda, Pagina, Selecao } from '../ui'

interface Alegacao { id: string; ordem: number; origem: string; resumo: string; citacao: string | null; citacaoConfere: boolean; fundamentos: { texto: string; na_base: boolean }[]; decisao: string | null; contraProva: string | null; fundamento: string | null; risco: boolean }
interface Recurso { id: string; recorrente: string; publicadoEm: string; link: string | null; texto: string; pecaId: string; leituraStatus: string; leituraErro: string | null; leituraModelo: string | null; prazoLegal: string | null; prazoInterno: string | null; alegacoes: Alegacao[] }
const DECISAO: Record<string, string> = { rebater: 'Rebater', concordar: 'Concordar (não rebater)', sem_relevancia: 'Sem relevância' }

// Um recurso de terceiro: alegações extraídas (IA ou manuais) → prova que refuta → fundamento. Sem prova = ponto de risco para o jurídico.
export default function RecursoPagina() {
  const { id } = useParams()
  const { empresa, pode } = useAcesso()
  const empresaId = empresa?.empresaId ?? null
  const det = useGet<Recurso>(empresaId && id ? `/empresas/${empresaId}/juridico/recursos/${id}` : null)
  const { enviando, erro, enviar } = useEnvio()
  const [nova, setNova] = useState({ resumo: '', citacao: '' })
  if (!empresaId || !id) return <p className="py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  if (det.erro) return <p className="py-10 text-center text-sm text-tertiary">Recurso não encontrado ou sem permissão.</p>
  if (!det.dados) return <p className="text-sm text-tertiary">Carregando…</p>
  const r = det.dados
  const editar = pode('juridico', 'elaborar_peca')
  const base = `/empresas/${empresaId}/juridico`
  const [rotulo, cor] = LEITURA[r.leituraStatus] ?? [r.leituraStatus, 'cinza' as const]
  const riscos = r.alegacoes.filter((a) => a.risco).length
  return (
    <Pagina larga>
      <Link to="/juridico">← Jurídico</Link>
      <CabecalhoPagina titulo={`Recurso de ${r.recorrente}`} subtitulo={`Divulgado em ${dataHoraSP(r.publicadoEm)}`} acoes={<Etiqueta cor={cor}>{rotulo}</Etiqueta>} />
      <Aviso texto={erro} />
      {r.prazoLegal ? <Aviso tipo="atencao" texto={`Prazo de contrarrazões na agenda: ${dataHoraSP(r.prazoLegal)}${r.prazoInterno ? ` (data interna ${dataHoraSP(r.prazoInterno)})` : ''}. ⚖️ Regra do prazo ainda não validada pelo jurídico: confira o edital.`} /> : null}
      {r.leituraStatus === 'desligada' ? <Aviso tipo="atencao" texto="A IA não está configurada: cadastre a chave em Cadastros → IA ou adicione as alegações à mão abaixo." /> : null}
      {r.leituraStatus === 'falhou' ? <Aviso texto={`A leitura falhou: ${r.leituraErro ?? 'erro desconhecido'}.`} /> : null}
      {riscos ? <Aviso tipo="atencao" texto={`${riscos} alegação(ões) a rebater sem prova que a refute: ponto de risco para o jurídico.`} /> : null}
      <div className="flex flex-wrap gap-3">
        <Link to={`/juridico/pecas/${r.pecaId}`}>Abrir a peça de contrarrazões →</Link>
        {editar ? <Botao variante="secundario" carregando={enviando || r.leituraStatus === 'pendente'} disabled={r.leituraStatus === 'pendente'} onClick={() => void enviar(async () => { await chamar('POST', `${base}/recursos/${r.id}/ler`); det.recarregar() })}>{r.leituraStatus === 'pendente' ? 'IA lendo…' : 'Ler de novo com IA'}</Botao> : null}
        {r.leituraStatus === 'pendente' ? <Botao variante="texto" onClick={det.recarregar}>Atualizar</Botao> : null}
      </div>
      <Legenda>A IA só lista as alegações do concorrente (com citação literal conferida no texto). Você decide como responder a cada uma; a minuta de contrarrazões sai ponto a ponto a partir daqui e continua sujeita à conferência de citações e à aprovação jurídica. (EM DESENVOLVIMENTO)</Legenda>
      {r.alegacoes.map((a) => <AlegacaoCartao key={a.id + (a.decisao ?? '') + (a.contraProva ?? '')} a={a} editar={editar} enviando={enviando} enviar={enviar} base={base} recarregar={det.recarregar} />)}
      {editar ? (
        <Cartao><h2>Adicionar alegação</h2>
          <Campo rotulo="Resumo da alegação" value={nova.resumo} onChange={(v) => setNova({ ...nova, resumo: v })} maxLength={600} />
          <Campo rotulo="Trecho literal do recurso (opcional, o sistema confere)" value={nova.citacao} onChange={(v) => setNova({ ...nova, citacao: v })} maxLength={1500} />
          <div><Botao carregando={enviando} disabled={nova.resumo.trim().length < 3} onClick={() => void enviar(async () => { await chamar('POST', `${base}/recursos/${r.id}/alegacoes`, { resumo: nova.resumo.trim(), citacao: nova.citacao.trim() || null }); setNova({ resumo: '', citacao: '' }); det.recarregar() })}>Adicionar</Botao></div></Cartao>
      ) : null}
      <Cartao><h2>Texto do recurso</h2>{r.link ? <Legenda>Link: <bdi>{r.link}</bdi></Legenda> : null}<pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{r.texto}</pre></Cartao>
    </Pagina>
  )
}

function AlegacaoCartao({ a, editar, enviando, enviar, base, recarregar }: { a: Alegacao; editar: boolean; enviando: boolean; enviar: (fn: () => Promise<void>) => Promise<unknown>; base: string; recarregar: () => void }) {
  const [d, setD] = useState({ decisao: a.decisao ?? 'rebater', prova: a.contraProva ?? '', fundamento: a.fundamento ?? '' })
  return (
    <Cartao>
      <span className="flex flex-wrap items-center gap-2"><strong>{a.ordem}. <bdi>{a.resumo}</bdi></strong>{a.origem === 'ia' ? <Etiqueta cor="cinza">Extraída pela IA</Etiqueta> : <Etiqueta cor="cinza">Manual</Etiqueta>}{a.risco ? <Etiqueta cor="erro">Ponto de risco: sem prova</Etiqueta> : null}</span>
      {a.citacao ? <Legenda>“<bdi>{a.citacao}</bdi>”{a.citacaoConfere ? ' · citação conferida no recurso' : ''}</Legenda> : <Legenda>Sem citação literal conferida no texto do recurso.</Legenda>}
      {a.fundamentos.length ? <Legenda>Fundamentos que o recorrente invoca: {a.fundamentos.map((f) => `${f.texto} (${f.na_base ? 'na sua base verificada' : 'FORA da sua base verificada'})`).join('; ')}</Legenda> : null}
      {editar ? <>
        <Selecao rotulo="Como responder" value={d.decisao} onChange={(v) => setD({ ...d, decisao: v })} opcoes={Object.entries(DECISAO).map(([valor, rotulo]) => ({ valor, rotulo }))} />
        <AreaTexto rotulo="Documento ou prova que refuta (ex.: ficha técnica, p. 3)" value={d.prova} onChange={(v) => setD({ ...d, prova: v })} rows={2} maxLength={1000} />
        <Campo rotulo="Fundamento da refutação (só fontes da base verificada)" value={d.fundamento} onChange={(v) => setD({ ...d, fundamento: v })} maxLength={1000} />
        <div className="flex flex-wrap gap-3">
          <Botao carregando={enviando} onClick={() => void enviar(async () => { await chamar('PUT', `${base}/alegacoes/${a.id}`, { decisao: d.decisao, contraProva: d.prova.trim() || null, fundamento: d.fundamento.trim() || null }); recarregar() })}>Salvar</Botao>
          <Botao variante="texto" carregando={enviando} onClick={() => void enviar(async () => { await chamar('DELETE', `${base}/alegacoes/${a.id}`); recarregar() })}>Remover alegação</Botao>
        </div></> : <Legenda>{DECISAO[a.decisao ?? ''] ?? 'Sem decisão ainda'}{a.contraProva ? ` · prova: ${a.contraProva}` : ''}</Legenda>}
    </Cartao>
  )
}
