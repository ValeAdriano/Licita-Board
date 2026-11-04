import { useState, type FormEvent } from 'react'
import { chamar, ErroApi } from '../../../api/cliente'
import { Aviso, Botao, Caixa, Campo, Etiqueta } from '../../../ui'
import { Secao } from '../conta/Secao'
import { useEnvio } from '../conta/useEnvio'
import { StepUpModal } from '../equipe/StepUpModal'
import { useGet } from '../useGet'
import { dataBr, ouNulo, opcoesUf, Selecao, useValorTemporario } from './comum'

interface Representante {
  id: string; tipo: string; nome: string; cpfMascara: string; cargo: string | null; email: string | null; telefone: string | null
  oabNumero: string | null; oabUf: string | null; ativo: boolean
}
interface Poder { slug: string; nome: string; provisorio: boolean }
interface Procuracao { id: string; numero: string | null; dataEmissao: string; dataValidade: string | null; revogadaEm: string | null; poderes: string[] }

const TIPOS = [{ valor: 'SOCIO_ADMINISTRADOR', rotulo: 'Sócio-administrador' }, { valor: 'PROCURADOR', rotulo: 'Procurador' }, { valor: 'ADVOGADO', rotulo: 'Advogado' }]
const rotuloTipo = (t: string) => TIPOS.find((x) => x.valor === t)?.rotulo ?? t

// Representantes legais, procuradores e advogados (Prompt 2.2). CPF cifrado: só máscara; revelar pede o
// código do autenticador. O signatário só vale dentro dos poderes e da validade (a regra mora no banco).
export function Representantes({ empresaId, pode }: { empresaId: string; pode: (acao: string) => boolean }) {
  const lista = useGet<Representante[]>(`/empresas/${empresaId}/representantes`)
  const [novo, setNovo] = useState(false)
  const [aberto, setAberto] = useState<string | null>(null)
  const sel = lista.dados?.find((r) => r.id === aberto)
  if (sel) return <Detalhe empresaId={empresaId} rep={sel} pode={pode} aoVoltar={() => { setAberto(null); lista.recarregar() }} />
  if (novo) return <Formulario empresaId={empresaId} aoFim={() => { setNovo(false); lista.recarregar() }} />
  return (
    <div className="flex flex-col gap-6">
      <Aviso texto={lista.erro} />
      {pode('cadastrar') ? <div><Botao onClick={() => setNovo(true)}>Novo representante</Botao></div> : null}
      {lista.dados?.length === 0 ? <p className="px-4 py-10 text-center text-sm text-tertiary">Nenhum representante cadastrado.</p> : null}
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {lista.dados?.map((r) => (
          <button key={r.id} type="button" className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setAberto(r.id)}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
              <strong><bdi>{r.nome}</bdi></strong>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">{rotuloTipo(r.tipo)}{r.oabNumero ? ` · OAB ${r.oabNumero}/${r.oabUf}` : ''} · CPF {r.cpfMascara}</span>
            </span>
            {!r.ativo ? <Etiqueta>inativo</Etiqueta> : null}
          </button>
        ))}
      </div>
    </div>
  )
}

function Formulario({ empresaId, aoFim }: { empresaId: string; aoFim: () => void }) {
  const [f, setF] = useState({ tipo: 'PROCURADOR', nome: '', cpf: '', cargo: '', email: '', telefone: '', oabNumero: '', oabUf: 'SP' })
  const { enviando, erro, enviar } = useEnvio()
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  const salvar = (e: FormEvent) => {
    e.preventDefault()
    return enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/representantes`, {
        tipo: f.tipo, nome: f.nome.trim(), cpf: f.cpf.trim(), cargo: ouNulo(f.cargo), email: ouNulo(f.email), telefone: ouNulo(f.telefone),
        ...(f.tipo === 'ADVOGADO' ? { oabNumero: f.oabNumero.trim(), oabUf: f.oabUf } : {}),
      })
      aoFim()
    })
  }
  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => void salvar(e)}>
      <h2>Novo representante</h2>
      <Selecao rotulo="Tipo" value={f.tipo} onChange={set('tipo')} opcoes={TIPOS} />
      <Campo rotulo="Nome" value={f.nome} onChange={(v) => set('nome')(v)} maxLength={200} />
      <Campo rotulo="CPF" value={f.cpf} onChange={(v) => set('cpf')(v)} maxLength={14} autoComplete="off" />
      <Campo rotulo="Cargo" value={f.cargo} onChange={(v) => set('cargo')(v)} maxLength={80} />
      <Campo rotulo="E-mail" type="email" value={f.email} onChange={(v) => set('email')(v)} maxLength={254} />
      <Campo rotulo="Telefone (com DDD)" value={f.telefone} onChange={(v) => set('telefone')(v)} maxLength={20} />
      {f.tipo === 'ADVOGADO' ? (
        <>
          <Campo rotulo="Número da OAB" value={f.oabNumero} onChange={(v) => set('oabNumero')(v)} maxLength={7} inputMode="numeric" />
          <Selecao rotulo="UF da OAB" value={f.oabUf} onChange={set('oabUf')} opcoes={opcoesUf} />
        </>
      ) : null}
      <Aviso texto={erro} />
      <Botao type="submit" cheio carregando={enviando}>Cadastrar</Botao>
      <Botao variante="texto" onClick={aoFim}>Cancelar</Botao>
    </form>
  )
}

function Detalhe({ empresaId, rep, pode, aoVoltar }: { empresaId: string; rep: Representante; pode: (acao: string) => boolean; aoVoltar: () => void }) {
  const { valor, mostrar, esconder } = useValorTemporario()
  const [pedindo, setPedindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const revelar = async (stepUp: string) => {
    try {
      const r = await chamar<{ valor: string }>('POST', `/empresas/${empresaId}/representantes/${rep.id}/revelar-cpf`, { stepUp })
      mostrar(rep.id, r.valor)
      setPedindo(false)
    } catch (e) {
      setPedindo(false)
      setErro(`${e instanceof ErroApi ? e.message : 'Não foi possível revelar.'} O código já foi usado: aguarde o próximo.`)
    }
  }
  const arquivar = async () => {
    await chamar('POST', `/empresas/${empresaId}/representantes/${rep.id}/arquivar`)
    aoVoltar()
  }
  return (
    <div className="flex flex-col gap-6">
      <Botao variante="texto" onClick={aoVoltar}>← Voltar</Botao>
      <Secao titulo={rep.nome}>
        <p>{rotuloTipo(rep.tipo)}{rep.cargo ? ` · ${rep.cargo}` : ''}</p>
        {rep.email ? <p className="text-sm text-tertiary [overflow-wrap:anywhere]">{rep.email}</p> : null}
        <p>
          CPF: <strong>{valor?.chave === rep.id ? valor.texto : rep.cpfMascara}</strong>{' '}
          {pode('editar') ? <Botao variante="texto" onClick={() => (valor?.chave === rep.id ? esconder() : setPedindo(true))}>{valor?.chave === rep.id ? 'Ocultar' : 'Mostrar'}</Botao> : null}
        </p>
        <Aviso texto={erro} />
        {pode('arquivar') ? <Botao variante="perigo" onClick={() => void arquivar()}>Arquivar representante</Botao> : null}
      </Secao>
      <Poderes empresaId={empresaId} rep={rep} podeEditar={pode('editar')} />
      <Procuracoes empresaId={empresaId} rep={rep} pode={pode} />
      <StepUpModal aberto={pedindo} escopo="dados_pessoais" descricao="CPF é dado pessoal: confirme com o código do autenticador. A consulta fica registrada." resumo={[`Mostrar o CPF de ${rep.nome}`]} aoConfirmar={revelar} aoCancelar={() => setPedindo(false)} />
    </div>
  )
}

function Poderes({ empresaId, rep, podeEditar }: { empresaId: string; rep: Representante; podeEditar: boolean }) {
  const catalogo = useGet<Poder[]>('/poderes')
  const atuais = useGet<string[]>(`/empresas/${empresaId}/representantes/${rep.id}/poderes`)
  const [sel, setSel] = useState<Set<string> | null>(null)
  const { enviando, erro, ok, enviar } = useEnvio()
  const marcados = sel ?? new Set(atuais.dados ?? [])
  if (rep.tipo !== 'SOCIO_ADMINISTRADOR') return null
  return (
    <Secao titulo="Poderes (contrato social)">
      <p className="text-sm text-tertiary [overflow-wrap:anywhere]">⚖️ Lista provisória de poderes, a confirmar com o jurídico.</p>
      {catalogo.dados?.map((p) => (
        <Caixa key={p.slug} rotulo={p.nome} desabilitado={!podeEditar} marcado={marcados.has(p.slug)} onChange={(v) => { const n = new Set(marcados); if (v) n.add(p.slug); else n.delete(p.slug); setSel(n) }} />
      ))}
      <Aviso texto={erro} />
      <Aviso tipo="info" texto={ok} />
      {podeEditar ? <Botao carregando={enviando} onClick={() => void enviar(async () => { await chamar('PUT', `/empresas/${empresaId}/representantes/${rep.id}/poderes`, { poderes: [...marcados] }); atuais.recarregar(); return 'Poderes salvos.' })}>Salvar poderes</Botao> : null}
    </Secao>
  )
}

function Procuracoes({ empresaId, rep, pode }: { empresaId: string; rep: Representante; pode: (acao: string) => boolean }) {
  const catalogo = useGet<Poder[]>('/poderes')
  const lista = useGet<Procuracao[]>(`/empresas/${empresaId}/representantes/${rep.id}/procuracoes`)
  const [f, setF] = useState({ numero: '', emissao: '', validade: '' })
  const [poderes, setPoderes] = useState<Set<string>>(new Set())
  const [chk, setChk] = useState({ data: '', poder: 'assinar_proposta' })
  const [resultado, setResultado] = useState<string | null>(null)
  const { enviando, erro, enviar } = useEnvio()
  const incluir = (e: FormEvent) => {
    e.preventDefault()
    return enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/representantes/${rep.id}/procuracoes`, { numero: ouNulo(f.numero), dataEmissao: f.emissao, dataValidade: f.validade || null, poderes: [...poderes] })
      setF({ numero: '', emissao: '', validade: '' })
      setPoderes(new Set())
      lista.recarregar()
    })
  }
  const verificar = async () => {
    const r = await chamar<{ valido: boolean }>('GET', `/empresas/${empresaId}/representantes/${rep.id}/signatario-valido?data=${chk.data}&poder=${chk.poder}`)
    setResultado(r.valido ? 'Pode assinar nessa data.' : 'NÃO pode assinar nessa data (sem poder, sem procuração válida ou vencida).')
  }
  const nomePoder = (s: string) => catalogo.dados?.find((p) => p.slug === s)?.nome ?? s
  return (
    <Secao titulo="Procurações">
      <p className="text-sm text-tertiary [overflow-wrap:anywhere]">⚖️ Procuração sem validade preenchida é tratada como inválida até o jurídico decidir.</p>
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {lista.dados?.map((p) => (
          <div key={p.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left flex-wrap">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
              <strong>{p.numero ? `Nº ${p.numero}` : 'Procuração'}</strong>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">{dataBr(p.dataEmissao)} a {dataBr(p.dataValidade)}{p.revogadaEm ? ` · revogada em ${dataBr(p.revogadaEm)}` : ''}</span>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">{p.poderes.map(nomePoder).join(', ') || 'sem poderes'}</span>
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              {pode('editar') && !p.revogadaEm ? <Botao variante="texto" onClick={() => void chamar('POST', `/empresas/${empresaId}/procuracoes/${p.id}/revogar`, { data: new Date().toISOString().slice(0, 10) }).then(lista.recarregar)}>Revogar hoje</Botao> : null}
              {pode('arquivar') ? <Botao variante="texto" onClick={() => void chamar('POST', `/empresas/${empresaId}/procuracoes/${p.id}/arquivar`).then(lista.recarregar)}>Arquivar</Botao> : null}
            </span>
          </div>
        ))}
      </div>
      {pode('cadastrar') ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => void incluir(e)}>
          <h3>Nova procuração</h3>
          <Campo rotulo="Número" value={f.numero} onChange={(v) => setF({ ...f, numero: v })} maxLength={60} />
          <Campo rotulo="Emissão" type="date" value={f.emissao} onChange={(v) => setF({ ...f, emissao: v })} />
          <Campo rotulo="Validade" type="date" value={f.validade} onChange={(v) => setF({ ...f, validade: v })} />
          {catalogo.dados?.map((p) => (
            <Caixa key={p.slug} rotulo={p.nome} marcado={poderes.has(p.slug)} onChange={(v) => { const n = new Set(poderes); if (v) n.add(p.slug); else n.delete(p.slug); setPoderes(n) }} />
          ))}
          <Aviso texto={erro} />
          <Botao type="submit" variante="secundario" carregando={enviando}>Incluir procuração</Botao>
        </form>
      ) : null}
      <h3>Pode assinar?</h3>
      <Campo rotulo="Data do documento" type="date" value={chk.data} onChange={(v) => setChk({ ...chk, data: v })} />
      <Selecao rotulo="Poder exigido" value={chk.poder} onChange={(v) => setChk({ ...chk, poder: v })} opcoes={(catalogo.dados ?? []).map((p) => ({ valor: p.slug, rotulo: p.nome }))} />
      <Botao variante="secundario" disabled={!chk.data} onClick={() => void verificar()}>Verificar</Botao>
      <Aviso tipo="info" texto={resultado} />
    </Secao>
  )
}
