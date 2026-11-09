import { useState, type FormEvent } from 'react'
import { enviarVersao, validarArquivo } from '../../../documentos/upload'
import { chamar, ErroApi } from '../../../api/cliente'
import { Arquivo, Aviso, Botao, Campo, Etiqueta } from '../../../ui'
import { Secao } from '../conta/Secao'
import { useEnvio } from '../conta/useEnvio'
import { useGet } from '../useGet'
import { Caixa, dataBr, Selecao } from './comum'

interface Tipo { id: string; slug: string; nome: string; pasta: string; exigeValidade: boolean; emissorUrl: string | null }
interface Doc { id: string; tipoId: string; descricao: string; numero: string | null; emissor: string | null; status: string; validade: string | null }
interface Pendencia { id: string; status: string; instrucoes: string; resultado: string | null; detalhe: string | null }
interface Versao { id: string; versao: number; nome: string; tipoReal: string | null; tamanho: string | null; emissao: string | null; validade: string | null; statusArquivo: string; motivoBloqueio: string | null }

const PASTAS: Record<string, string> = {
  habilitacao_juridica: 'Habilitação jurídica', economico_financeira: 'Econômico-financeira', fiscal_trabalhista: 'Fiscal e trabalhista',
  tecnica: 'Qualificação técnica', timbrado_modelos: 'Timbrado e modelos', juridico: 'Jurídico', licitacao: 'Documentos da licitação',
}
const STATUS: Record<string, string> = { valido: 'Válido', a_vencer: 'A vencer', vencido: 'Vencido', em_atualizacao: 'Em atualização', pendente: 'Pendente' }

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
    <div className="flex flex-col gap-6">
      <Aviso texto={lista.erro} />
      {pode('cadastrar') ? <div><Botao onClick={() => setAberto('novo')}>Novo documento</Botao></div> : null}
      {lista.dados?.length === 0 ? <p className="px-4 py-10 text-center text-sm text-tertiary">Nenhum documento cadastrado.</p> : null}
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {lista.dados?.map((d) => (
          <button key={d.id} type="button" className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setAberto(d.id)}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
              <strong><bdi>{d.descricao}</bdi></strong>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">{PASTAS[nomeTipo(d.tipoId)?.pasta ?? ''] ?? ''} · {nomeTipo(d.tipoId)?.nome} · validade {dataBr(d.validade)}</span>
            </span>
            <Etiqueta cor={d.status === 'vencido' ? 'aviso' : 'cinza'}>{STATUS[d.status] ?? d.status}</Etiqueta>
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
    <form className="flex flex-col gap-6" onSubmit={(e) => void salvar(e)}>
      <h2>Novo documento</h2>
      <Selecao rotulo="Tipo" value={f.tipoId} onChange={(v) => setF({ ...f, tipoId: v })} opcoes={tipos.map((t) => ({ valor: t.id, rotulo: `${PASTAS[t.pasta]} · ${t.nome}` }))} />
      <Campo rotulo="Descrição" value={f.descricao} onChange={(v) => setF({ ...f, descricao: v })} maxLength={300} />
      <Campo rotulo="Número" value={f.numero} onChange={(v) => setF({ ...f, numero: v })} maxLength={80} />
      <Campo rotulo="Emissor" value={f.emissor} onChange={(v) => setF({ ...f, emissor: v })} maxLength={200} />
      <Caixa rotulo="Sem vencimento" marcado={f.semVencimento} onChange={(v) => setF({ ...f, semVencimento: v })} />
      <Aviso texto={erro} />
      <Botao type="submit" cheio carregando={enviando}>Criar documento</Botao>
      <Botao variante="texto" onClick={aoFim}>Cancelar</Botao>
    </form>
  )
}

function Detalhe({ empresaId, doc, tipo, pode, aoVoltar }: { empresaId: string; doc: Doc; tipo: Tipo | undefined; pode: (acao: string) => boolean; aoVoltar: () => void }) {
  const versoes = useGet<Versao[]>(`/empresas/${empresaId}/documentos/${doc.id}/versoes`)
  const pendencias = useGet<Pendencia[]>(`/empresas/${empresaId}/documentos/${doc.id}/pendencias`)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [instrucoes, setInstrucoes] = useState('')
  const [detalhe, setDetalhe] = useState('')
  const aberta = pendencias.dados?.find((p) => p.status === 'aberta')
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
      const f = arquivo
      validarArquivo(f)
      setMsg('Enviando…')
      const versaoId = await enviarVersao(empresaId, doc.id, f, emissao, validade)
      setMsg('Verificando o arquivo (antivírus e tipo)…')
      const r = await aguardar(versaoId)
      versoes.recarregar()
      setMsg(null)
      if (!r) return 'Verificação em andamento: volte em instantes.'
      if (r.statusArquivo === 'bloqueado') throw new ErroApi(422, `Arquivo bloqueado: ${r.motivoBloqueio ?? 'não passou na verificação'}.`)
      setArquivo(null)
      return 'Arquivo liberado.'
    })
  const baixar = async (v: Versao) => {
    const r = await chamar<{ url: string }>('POST', `/empresas/${empresaId}/versoes/${v.id}/download`)
    window.location.assign(r.url)
  }
  return (
    <div className="flex flex-col gap-6">
      <Botao variante="texto" onClick={aoVoltar}>← Voltar</Botao>
      <Secao titulo={doc.descricao}>
        <p>{tipo?.nome} · {STATUS[doc.status] ?? doc.status} · validade {dataBr(doc.validade)}</p>
        {tipo?.emissorUrl ? <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Emitir uma nova via: <a href={tipo.emissorUrl} target="_blank" rel="noreferrer noopener">site do emissor</a></p> : null}
        {pode('arquivar') ? <Botao variante="perigo" onClick={() => void chamar('POST', `/empresas/${empresaId}/documentos/${doc.id}/arquivar`).then(aoVoltar)}>Arquivar documento</Botao> : null}
      </Secao>
      <Secao titulo="Atualizar documento">
        <p className="text-sm text-tertiary [overflow-wrap:anywhere]">O sistema não emite certidão nem simula renovação: abra uma pendência, emita no site do emissor e envie o arquivo novo. Ela fecha sozinha quando o arquivo é liberado.</p>
        {pendencias.dados?.map((p) => (
          <p key={p.id}><strong>{p.status === 'aberta' ? 'Em aberto' : p.resultado === 'sucesso' ? 'Atualizado' : 'Falhou'}:</strong> <bdi>{p.instrucoes}</bdi>{p.detalhe ? <> · <bdi>{p.detalhe}</bdi></> : null}</p>
        ))}
        {pode('editar') && !aberta ? (
          <div className="flex flex-col gap-4">
            <Campo rotulo="Instruções (o que fazer e onde)" value={instrucoes} onChange={(v) => setInstrucoes(v)} maxLength={1000} />
            <Botao disabled={!instrucoes.trim()} onClick={() => void chamar('POST', `/empresas/${empresaId}/documentos/${doc.id}/pendencias`, { instrucoes: instrucoes.trim() }).then(() => { setInstrucoes(''); pendencias.recarregar(); aoVoltar() })}>Abrir pendência de atualização</Botao>
          </div>
        ) : null}
        {pode('editar') && aberta ? (
          <div className="flex flex-col gap-4">
            <Campo rotulo="Motivo da falha (se não foi possível atualizar)" value={detalhe} onChange={(v) => setDetalhe(v)} maxLength={500} />
            <Botao variante="secundario" disabled={!detalhe.trim()} onClick={() => void chamar('POST', `/empresas/${empresaId}/pendencias/${aberta.id}/falha`, { detalhe: detalhe.trim() }).then(() => { setDetalhe(''); aoVoltar() })}>Registrar falha</Botao>
          </div>
        ) : null}
      </Secao>
      <Secao titulo="Versões (nada é sobrescrito)">
        <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
          {versoes.dados?.map((v) => (
            <div key={v.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left flex-wrap">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
                <strong>Versão {v.versao} · <bdi>{v.nome}</bdi></strong>
                <span className="text-sm text-tertiary [overflow-wrap:anywhere]">{v.statusArquivo === 'liberado' ? 'Liberado' : v.statusArquivo === 'bloqueado' ? `Bloqueado: ${v.motivoBloqueio ?? ''}` : 'Em verificação'} · validade {dataBr(v.validade)}</span>
              </span>
              {v.statusArquivo === 'liberado' && pode('visualizar') ? <Botao variante="secundario" onClick={() => void baixar(v)}>Baixar</Botao> : null}
            </div>
          ))}
        </div>
        {pode('cadastrar') ? (
          <div className="flex flex-col gap-4">
            <h3>Enviar nova versão</h3>
            <Arquivo rotulo="Arquivo (PDF, imagem, Word, Excel; até 25 MB)" arquivo={arquivo} aoEscolher={setArquivo} aceita={['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.xlsx', '.odt', '.doc', '.xls']} />
            <Campo rotulo="Data de emissão" type="date" value={emissao} onChange={(v) => setEmissao(v)} />
            <Campo rotulo="Validade" type="date" value={validade} onChange={(v) => setValidade(v)} />
            <Aviso texto={erro} />
            <Aviso tipo="info" texto={msg} />
            <Botao carregando={enviando} onClick={() => void enviarArquivo()}>Enviar arquivo</Botao>
          </div>
        ) : null}
      </Secao>
    </div>
  )
}
