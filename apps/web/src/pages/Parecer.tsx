import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { chamar } from '../api/cliente'
import { useEnvio } from '../features/acesso/conta/useEnvio'
import { useAcesso } from '../features/acesso/contexto'
import { useGet } from '../features/acesso/useGet'
import { RECOMENDACAO } from '../features/juridico/Pareceres'
import { AreaTexto, Aviso, Botao, CabecalhoPagina, Campo, Cartao, Etiqueta, Legenda, Pagina, Selecao } from '../ui'

interface Achado { id: string; ordem: number; origem: string; tipo: string; descricao: string; citacaoConcorrente: string | null; concorrenteConfere: boolean; citacaoEdital: string | null; editalConfere: boolean; paginaEdital: number | null; prova: string | null; fundamento: string | null; classificacao: string | null }
interface Detalhe {
  resultado: { resultado: string; vencedoraNome: string | null; vencedoraMarcaModelo: string | null; motivo: string | null; gatilhoRecursal: boolean; numeroItem: number | null; item: string | null; numeroEdital: string | null; orgao: string | null }
  parecer: { id: string; concorrente: string; texto: string | null; recomendacao: string | null; recomendacaoJustificativa: string | null; validacao: { codigo: string; mensagem: string; bloqueia: boolean }[] | null; validadaEm: string | null; bloqueado: boolean; analiseStatus: string; analiseErro: string | null; pecaId: string | null } | null
  achados: Achado[]
}
const TIPO: Record<string, string> = { certidao: 'Certidão', economico_financeiro: 'Econômico-financeiro', atestado: 'Atestado', signatario: 'Signatário', me_epp: 'ME/EPP', produto_tecnico: 'Produto/técnico', proposta: 'Proposta', inexequibilidade: 'Inexequibilidade', outro: 'Outro' }
const CLASSE: Record<string, string> = { forte: 'Forte', moderada: 'Moderada', fraca: 'Fraca' }

// Parecer de viabilidade recursal de um item (10.4): achados com prova, fundamento (base verificada) e classificação; recomendação do jurídico.
export default function ParecerPagina() {
  const { participacao } = useParams()
  const { empresa, pode } = useAcesso()
  const empresaId = empresa?.empresaId ?? null
  const det = useGet<Detalhe>(empresaId && participacao ? `/empresas/${empresaId}/juridico/pareceres/participacao/${participacao}` : null)
  const { enviando, erro, enviar } = useEnvio()
  const navegar = useNavigate()
  const [abrir, setAbrir] = useState({ concorrente: '', texto: '' })
  const [rec, setRec] = useState({ recomendacao: 'recorrer', justificativa: '' })
  if (!empresaId || !participacao) return <p className="py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  if (det.erro) return <p className="py-10 text-center text-sm text-tertiary">Item não encontrado ou sem permissão.</p>
  if (!det.dados) return <p className="text-sm text-tertiary">Carregando…</p>
  const { resultado: r, parecer: p, achados } = det.dados
  const base = `/empresas/${empresaId}/juridico/pareceres`
  const editar = pode('juridico', 'elaborar_peca')
  const bloqueios = (p?.validacao ?? []).filter((x) => x.bloqueia)
  const avisos = (p?.validacao ?? []).filter((x) => !x.bloqueia)
  return (
    <Pagina larga>
      <Link to="/juridico">← Jurídico</Link>
      <CabecalhoPagina titulo={`Viabilidade recursal · item ${r.numeroItem ?? '—'}`} subtitulo={`${r.orgao ?? ''}${r.numeroEdital ? ` · edital nº ${r.numeroEdital}` : ''} · ${r.item ?? ''}`} acoes={p ? <Etiqueta cor="marca">Parecer aberto</Etiqueta> : null} />
      <Aviso texto={erro} />
      <Legenda>Resultado: {r.resultado}{r.vencedoraNome ? ` · vencedora: ${r.vencedoraNome}` : ''}{r.vencedoraMarcaModelo ? ` (${r.vencedoraMarcaModelo})` : ''}{r.motivo ? ` · motivo: ${r.motivo}` : ''}. ⚖️ Os critérios de classificação (forte, moderada, fraca) são do jurídico: o sistema só confere se há prova, fundamento da base verificada e citação no texto. (EM DESENVOLVIMENTO)</Legenda>
      {!p ? (
        editar && r.gatilhoRecursal ? (
          <Cartao><h2>Abrir o parecer</h2>
            <Campo rotulo="Licitante vencedora (ou arrematante)" value={abrir.concorrente || (r.vencedoraNome ?? '')} onChange={(v) => setAbrir({ ...abrir, concorrente: v })} maxLength={200} />
            <AreaTexto rotulo="Texto da proposta e dos documentos de habilitação da concorrente (cole; opcional agora)" value={abrir.texto} onChange={(v) => setAbrir({ ...abrir, texto: v })} rows={8} maxLength={60000} />
            <div><Botao carregando={enviando} disabled={(abrir.concorrente || r.vencedoraNome || '').trim().length < 2} onClick={() => void enviar(async () => { await chamar('POST', `${base}/participacao/${participacao}`, { concorrente: (abrir.concorrente || r.vencedoraNome || '').trim(), texto: abrir.texto.trim() || null }); det.recarregar() })}>Abrir parecer</Botao></div></Cartao>
        ) : <Aviso tipo="info" texto="Ainda não há parecer para este item." />
      ) : <>
        {bloqueios.length ? <div role="alert" className="flex flex-col gap-1 rounded-xl border border-error bg-error-primary p-3 text-sm text-error-primary"><strong>Evidência bloqueando ({bloqueios.length})</strong><ul className="list-disc pl-5">{bloqueios.map((b) => <li key={b.codigo + b.mensagem} className="[overflow-wrap:anywhere]">{b.mensagem}</li>)}</ul></div> : p.validadaEm ? <Etiqueta cor="sucesso">Evidência conferida sem bloqueios</Etiqueta> : <Aviso tipo="info" texto="Conferindo a evidência… atualize em instantes." />}
        {avisos.length ? <ul className="list-disc pl-5 text-sm text-warning-primary">{avisos.map((b) => <li key={b.codigo + b.mensagem}>{b.mensagem}</li>)}</ul> : null}
        <Cartao>
          <h2>Análise da vencedora: {p.concorrente}</h2>
          {p.analiseStatus === 'desligada' ? <Aviso tipo="atencao" texto="A IA não está configurada: cadastre a chave em Cadastros → IA ou registre os achados à mão." /> : null}
          {p.analiseStatus === 'falhou' ? <Aviso texto={`A análise falhou: ${p.analiseErro ?? 'erro desconhecido'}.`} /> : null}
          {p.analiseStatus === 'concluida' && p.analiseErro ? <Aviso tipo="info" texto={p.analiseErro} /> : null}
          <Legenda>Cole o texto da proposta e dos documentos da concorrente; a IA sugere possíveis falhas citando trechos literais (sem classificar nem recomendar). Nada da sua empresa é enviado.</Legenda>
          <div className="flex flex-wrap gap-3">
            {editar ? <Botao variante="secundario" carregando={enviando || p.analiseStatus === 'pendente'} disabled={p.analiseStatus === 'pendente' || (p.texto ?? '').trim().length < 50} onClick={() => void enviar(async () => { await chamar('POST', `${base}/${p.id}/analisar`); det.recarregar() })}>{p.analiseStatus === 'pendente' ? 'IA analisando…' : 'Sugerir achados com IA'}</Botao> : null}
            {p.analiseStatus === 'pendente' ? <Botao variante="texto" onClick={det.recarregar}>Atualizar</Botao> : null}
          </div>
          {editar ? <TextoConcorrente key={p.texto ?? ''} p={p} participacao={participacao} base={base} enviando={enviando} enviar={enviar} recarregar={det.recarregar} /> : null}
        </Cartao>
        {achados.map((a) => <AchadoCartao key={a.id + a.paginaEdital + String(a.concorrenteConfere)} a={a} parecerId={p.id} editar={editar} enviando={enviando} enviar={enviar} base={base} recarregar={det.recarregar} />)}
        {editar ? <NovoAchado parecerId={p.id} base={base} enviando={enviando} enviar={enviar} recarregar={det.recarregar} /> : null}
        <Cartao><h2>Recomendação do jurídico</h2>
          {p.recomendacao ? <Legenda>Atual: <strong>{RECOMENDACAO[p.recomendacao]}</strong> · <bdi>{p.recomendacaoJustificativa}</bdi></Legenda> : <Legenda>Ainda sem recomendação.</Legenda>}
          {pode('juridico', 'aprovar_peca') ? <>
            <Selecao rotulo="Recomendação" value={rec.recomendacao} onChange={(v) => setRec({ ...rec, recomendacao: v })} opcoes={Object.entries(RECOMENDACAO).map(([valor, rotulo]) => ({ valor, rotulo }))} />
            <Campo rotulo="Justificativa (obrigatória)" value={rec.justificativa} onChange={(v) => setRec({ ...rec, justificativa: v })} maxLength={1000} />
            <div><Botao carregando={enviando} disabled={rec.justificativa.trim().length < 10} onClick={() => void enviar(async () => { await chamar('PUT', `${base}/${p.id}/recomendacao`, rec); det.recarregar() })}>Registrar recomendação</Botao></div></> : <Legenda>Só quem tem permissão de aprovar peças registra a recomendação.</Legenda>}
          {p.pecaId ? <Link to={`/juridico/pecas/${p.pecaId}`}>Abrir a peça de recurso →</Link> : editar && p.recomendacao === 'recorrer' ? (
            <div><Botao variante="secundario" carregando={enviando} disabled={!p.validadaEm || p.bloqueado} onClick={() => void enviar(async () => { const r2 = await chamar<{ pecaId: string }>('POST', `${base}/${p.id}/recurso`); navegar(`/juridico/pecas/${r2.pecaId}`) })}>Abrir a peça de recurso</Botao><Legenda>Só abre com a evidência conferida e sem bloqueios. O sistema nunca protocola o recurso.</Legenda></div>
          ) : null}
        </Cartao>
      </>}
    </Pagina>
  )
}

type Enviar = (fn: () => Promise<void>) => Promise<unknown>
function TextoConcorrente({ p, participacao, base, enviando, enviar, recarregar }: { p: NonNullable<Detalhe['parecer']>; participacao: string; base: string; enviando: boolean; enviar: Enviar; recarregar: () => void }) {
  const [t, setT] = useState(p.texto ?? '')
  return <>
    <AreaTexto rotulo="Texto da proposta e dos documentos da concorrente" value={t} onChange={setT} rows={6} maxLength={60000} />
    <div><Botao variante="secundario" carregando={enviando} onClick={() => void enviar(async () => { await chamar('POST', `${base}/participacao/${participacao}`, { concorrente: p.concorrente, texto: t.trim() || null }); recarregar() })}>Salvar texto</Botao></div>
  </>
}

function AchadoCartao({ a, parecerId, editar, enviando, enviar, base, recarregar }: { a: Achado; parecerId: string; editar: boolean; enviando: boolean; enviar: Enviar; base: string; recarregar: () => void }) {
  const [d, setD] = useState({ tipo: a.tipo, descricao: a.descricao, citC: a.citacaoConcorrente ?? '', citE: a.citacaoEdital ?? '', prova: a.prova ?? '', fundamento: a.fundamento ?? '', classificacao: a.classificacao ?? '' })
  return (
    <Cartao>
      <span className="flex flex-wrap items-center gap-2"><strong>{a.ordem}. <bdi>{a.descricao}</bdi></strong><Etiqueta cor="cinza">{TIPO[a.tipo] ?? a.tipo}</Etiqueta>{a.origem === 'ia' ? <Etiqueta cor="cinza">Sugerido pela IA</Etiqueta> : null}{a.classificacao ? <Etiqueta cor={a.classificacao === 'forte' ? 'sucesso' : a.classificacao === 'moderada' ? 'aviso' : 'cinza'}>{CLASSE[a.classificacao]}</Etiqueta> : <Etiqueta cor="aviso">Sem classificação</Etiqueta>}</span>
      {a.citacaoConcorrente ? <Legenda>Concorrente: “<bdi>{a.citacaoConcorrente}</bdi>” {a.concorrenteConfere ? '· conferida no texto' : '· NÃO localizada no texto inserido'}</Legenda> : null}
      {a.citacaoEdital ? <Legenda>Edital: “<bdi>{a.citacaoEdital}</bdi>” {a.editalConfere ? `· conferida (página ${a.paginaEdital ?? '—'})` : '· NÃO localizada no edital'}</Legenda> : null}
      {editar ? <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Selecao rotulo="Tipo" value={d.tipo} onChange={(v) => setD({ ...d, tipo: v })} opcoes={Object.entries(TIPO).map(([valor, rotulo]) => ({ valor, rotulo }))} />
          <Selecao rotulo="Classificação (decisão do jurídico)" value={d.classificacao} onChange={(v) => setD({ ...d, classificacao: v })} vazio="Sem classificação" opcoes={Object.entries(CLASSE).map(([valor, rotulo]) => ({ valor, rotulo }))} />
        </div>
        <Campo rotulo="Descrição da falha" value={d.descricao} onChange={(v) => setD({ ...d, descricao: v })} maxLength={600} />
        <Campo rotulo="Trecho literal da concorrente" value={d.citC} onChange={(v) => setD({ ...d, citC: v })} maxLength={1500} />
        <Campo rotulo="Cláusula literal do edital" value={d.citE} onChange={(v) => setD({ ...d, citE: v })} maxLength={1500} />
        <Campo rotulo="Prova (documento e página)" value={d.prova} onChange={(v) => setD({ ...d, prova: v })} maxLength={1000} />
        <Campo rotulo="Fundamento (cite só fontes da base verificada)" value={d.fundamento} onChange={(v) => setD({ ...d, fundamento: v })} maxLength={500} />
        <div className="flex flex-wrap gap-3">
          <Botao carregando={enviando} disabled={d.descricao.trim().length < 3} onClick={() => void enviar(async () => { await chamar('PUT', `${base}/${parecerId}/achados/${a.id}`, { tipo: d.tipo, descricao: d.descricao.trim(), citacaoConcorrente: d.citC.trim() || null, citacaoEdital: d.citE.trim() || null, prova: d.prova.trim() || null, fundamento: d.fundamento.trim() || null, classificacao: d.classificacao || null }); recarregar() })}>Salvar</Botao>
          <Botao variante="texto" carregando={enviando} onClick={() => void enviar(async () => { await chamar('DELETE', `${base}/achados/${a.id}`); recarregar() })}>Remover achado</Botao>
        </div></> : <Legenda>{a.prova ? `Prova: ${a.prova}` : 'Sem prova indicada'}{a.fundamento ? ` · fundamento: ${a.fundamento}` : ''}</Legenda>}
    </Cartao>
  )
}

function NovoAchado({ parecerId, base, enviando, enviar, recarregar }: { parecerId: string; base: string; enviando: boolean; enviar: Enviar; recarregar: () => void }) {
  const [n, setN] = useState({ tipo: 'certidao', descricao: '' })
  return (
    <Cartao><h2>Adicionar achado</h2>
      <Selecao rotulo="Tipo" value={n.tipo} onChange={(v) => setN({ ...n, tipo: v })} opcoes={Object.entries(TIPO).map(([valor, rotulo]) => ({ valor, rotulo }))} />
      <Campo rotulo="Descrição da falha" value={n.descricao} onChange={(v) => setN({ ...n, descricao: v })} maxLength={600} />
      <div><Botao carregando={enviando} disabled={n.descricao.trim().length < 3} onClick={() => void enviar(async () => { await chamar('POST', `${base}/${parecerId}/achados`, { tipo: n.tipo, descricao: n.descricao.trim() }); setN({ ...n, descricao: '' }); recarregar() })}>Adicionar</Botao></div></Cartao>
  )
}
