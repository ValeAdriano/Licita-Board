import { useRef, useState, type FormEvent } from 'react'
import { chamar, ErroApi } from '../../../api/cliente'
import { Aviso, Botao, Campo } from '../../../ui'
import { Secao } from '../conta/Secao'
import { useEnvio } from '../conta/useEnvio'
import { useGet } from '../useGet'
import { Caixa, dataBr, Selecao } from './comum'

interface Tipo { id: string; slug: string; nome: string; pasta: string; exigeValidade: boolean; emissorUrl: string | null }
interface Doc { id: string; tipoId: string; descricao: string; numero: string | null; emissor: string | null; status: string; validade: string | null }
interface Versao { id: string; versao: number; nome: string; tipoReal: string | null; tamanho: string | null; emissao: string | null; validade: string | null; statusArquivo: string; motivoBloqueio: string | null }

const PASTAS: Record<string, string> = {
  habilitacao_juridica: 'Habilitação jurídica', economico_financeira: 'Econômico-financeira', fiscal_trabalhista: 'Fiscal e trabalhista',
  tecnica: 'Qualificação técnica', timbrado_modelos: 'Timbrado e modelos', juridico: 'Jurídico',
}
const STATUS: Record<string, string> = { valido: 'Válido', a_vencer: 'A vencer', vencido: 'Vencido', em_atualizacao: 'Em atualização', pendente: 'Pendente' }
const MAX = 25 * 1024 * 1024

// Repositório documental (Fase 03): o arquivo vai direto ao S3 por URL assinada, fica em quarentena e só é
// liberado depois do antivírus, do tipo real e do SHA-256. Vencidos aparecem primeiro e em destaque.
export function Documentos({ empresaId, pode }: { empresaId: string; pode: (acao: string) => boolean }) {
  const tipos = useGet<Tipo[]>('/documentos/tipos')
  const lista = useGet<Doc[]>(`/empresas/${empresaId}/documentos`)
  const [aberto, setAberto] = useState<string | 'novo' | null>(null)
  const doc = lista.dados?.find((d) => d.id === aberto)
  const nomeTipo = (id: string) => tipos.dados?.find((t) => t.id === id)
  if (aberto === 'novo') return <Novo empresaId={empresaId} tipos={tipos.dados ?? []} aoFim={() => { setAberto(null); lista.recarregar() }} />
  if (doc) return <Detalhe empresaId={empresaId} doc={doc} tipo={nomeTipo(doc.tipoId)} pode={pode} aoVoltar={() => { setAberto(null); lista.recarregar() }} />
  return (
    <div className="pilha pilha--grande">
      <Aviso texto={lista.erro} />
      {pode('cadastrar') ? <div><Botao onClick={() => setAberto('novo')}>Novo documento</Botao></div> : null}
      {lista.dados?.length === 0 ? <p className="vazio">Nenhum documento cadastrado.</p> : null}
      <div className="lista">
        {lista.dados?.map((d) => (
          <button key={d.id} type="button" className="lista__item" onClick={() => setAberto(d.id)}>
            <span className="lista__texto">
              <strong><bdi>{d.descricao}</bdi></strong>
              <span className="legenda">{PASTAS[nomeTipo(d.tipoId)?.pasta ?? ''] ?? ''} · {nomeTipo(d.tipoId)?.nome} · validade {dataBr(d.validade)}</span>
            </span>
            <span className={d.status === 'vencido' ? 'tag tag--aviso' : 'tag'}>{STATUS[d.status] ?? d.status}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Novo({ empresaId, tipos, aoFim }: { empresaId: string; tipos: Tipo[]; aoFim: () => void }) {
  const [f, setF] = useState({ tipoId: tipos[0]?.id ?? '', descricao: '', numero: '', emissor: '', semVencimento: false })
  const { enviando, erro, enviar } = useEnvio()
  const salvar = (e: FormEvent) => {
    e.preventDefault()
    return enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/documentos`, { tipoId: f.tipoId, descricao: f.descricao.trim(), numero: f.numero.trim() || null, emissor: f.emissor.trim() || null, semVencimento: f.semVencimento })
      aoFim()
    })
  }
  return (
    <form className="pilha pilha--grande" onSubmit={(e) => void salvar(e)}>
      <h2>Novo documento</h2>
      <Selecao rotulo="Tipo" value={f.tipoId} onChange={(v) => setF({ ...f, tipoId: v })} opcoes={tipos.map((t) => ({ valor: t.id, rotulo: `${PASTAS[t.pasta]} · ${t.nome}` }))} />
      <Campo rotulo="Descrição" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} maxLength={300} />
      <Campo rotulo="Número" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} maxLength={80} />
      <Campo rotulo="Emissor" value={f.emissor} onChange={(e) => setF({ ...f, emissor: e.target.value })} maxLength={200} />
      <Caixa rotulo="Sem vencimento" marcado={f.semVencimento} onChange={(v) => setF({ ...f, semVencimento: v })} />
      <Aviso texto={erro} />
      <Botao type="submit" cheio carregando={enviando}>Criar documento</Botao>
      <Botao variante="texto" onClick={aoFim}>Cancelar</Botao>
    </form>
  )
}

function Detalhe({ empresaId, doc, tipo, pode, aoVoltar }: { empresaId: string; doc: Doc; tipo: Tipo | undefined; pode: (acao: string) => boolean; aoVoltar: () => void }) {
  const versoes = useGet<Versao[]>(`/empresas/${empresaId}/documentos/${doc.id}/versoes`)
  const arquivo = useRef<HTMLInputElement>(null)
  const [emissao, setEmissao] = useState('')
  const [validade, setValidade] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const { enviando, erro, enviar } = useEnvio()

  const aguardar = async (id: string) => {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      const l = await chamar<Versao[]>('GET', `/empresas/${empresaId}/documentos/${doc.id}/versoes`)
      const v = l.find((x) => x.id === id)
      if (v && v.statusArquivo !== 'quarentena') return v
    }
    return null
  }
  const enviarArquivo = () =>
    enviar(async () => {
      const f = arquivo.current?.files?.[0]
      if (!f) throw new ErroApi(400, 'Escolha um arquivo.')
      if (f.size > MAX) throw new ErroApi(400, 'O arquivo passa de 25 MB.')
      setMsg('Enviando…')
      const v = await chamar<{ versaoId: string; url: string }>('POST', `/empresas/${empresaId}/documentos/${doc.id}/versoes`, { nome: f.name, tamanho: f.size, emissao: emissao || null, validade: validade || null })
      const put = await fetch(v.url, { method: 'PUT', body: f })
      if (!put.ok) throw new ErroApi(502, 'Falha ao enviar o arquivo.')
      await chamar('POST', `/empresas/${empresaId}/versoes/${v.versaoId}/concluir`)
      setMsg('Verificando o arquivo (antivírus e tipo)…')
      const r = await aguardar(v.versaoId)
      versoes.recarregar()
      setMsg(null)
      if (!r) return 'Verificação em andamento: volte em instantes.'
      if (r.statusArquivo === 'bloqueado') throw new ErroApi(422, `Arquivo bloqueado: ${r.motivoBloqueio ?? 'não passou na verificação'}.`)
      if (arquivo.current) arquivo.current.value = ''
      return 'Arquivo liberado.'
    })
  const baixar = async (v: Versao) => {
    const r = await chamar<{ url: string }>('POST', `/empresas/${empresaId}/versoes/${v.id}/download`)
    window.location.assign(r.url)
  }
  return (
    <div className="pilha pilha--grande">
      <Botao variante="texto" onClick={aoVoltar}>← Voltar</Botao>
      <Secao titulo={doc.descricao}>
        <p>{tipo?.nome} · {STATUS[doc.status] ?? doc.status} · validade {dataBr(doc.validade)}</p>
        {tipo?.emissorUrl ? <p className="legenda">Emitir uma nova via: <a href={tipo.emissorUrl} target="_blank" rel="noreferrer noopener">site do emissor</a></p> : null}
        {pode('arquivar') ? <Botao variante="perigo" onClick={() => void chamar('POST', `/empresas/${empresaId}/documentos/${doc.id}/arquivar`).then(aoVoltar)}>Arquivar documento</Botao> : null}
      </Secao>
      <Secao titulo="Versões (nada é sobrescrito)">
        <div className="lista">
          {versoes.dados?.map((v) => (
            <div key={v.id} className="lista__item lista__item--acoes" style={{ cursor: 'default' }}>
              <span className="lista__texto">
                <strong>Versão {v.versao} · <bdi>{v.nome}</bdi></strong>
                <span className="legenda">{v.statusArquivo === 'liberado' ? 'Liberado' : v.statusArquivo === 'bloqueado' ? `Bloqueado: ${v.motivoBloqueio ?? ''}` : 'Em verificação'} · validade {dataBr(v.validade)}</span>
              </span>
              {v.statusArquivo === 'liberado' && pode('visualizar') ? <Botao variante="secundario" onClick={() => void baixar(v)}>Baixar</Botao> : null}
            </div>
          ))}
        </div>
        {pode('cadastrar') ? (
          <div className="pilha">
            <h3>Enviar nova versão</h3>
            <span className="campo__rotulo">Arquivo (PDF, imagem, Word, Excel; até 25 MB)</span>
            <input ref={arquivo} type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.odt,.doc,.xls" aria-label="Arquivo" />
            <Campo rotulo="Data de emissão" type="date" value={emissao} onChange={(e) => setEmissao(e.target.value)} />
            <Campo rotulo="Validade" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
            <Aviso texto={erro} />
            <Aviso tipo="info" texto={msg} />
            <Botao carregando={enviando} onClick={() => void enviarArquivo()}>Enviar arquivo</Botao>
          </div>
        ) : null}
      </Secao>
    </div>
  )
}
