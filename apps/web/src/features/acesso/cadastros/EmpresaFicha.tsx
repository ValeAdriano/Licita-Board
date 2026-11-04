import { useState, type FormEvent } from 'react'
import { chamar, ErroApi } from '../../../api/cliente'
import { Aviso, Botao, Campo } from '../../../ui'
import { cnpjLegivel } from '../cnpj'
import { Secao } from '../conta/Secao'
import { useEnvio } from '../conta/useEnvio'
import { useGet } from '../useGet'
import { Caixa, dataBr, ouNulo, opcoesUf, Selecao } from './comum'

interface Ficha {
  razaoSocial: string; nomeFantasia: string | null; cnpj: string; inscricaoEstadual: string | null; inscricaoMunicipal: string | null
  cnaePrincipal: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null
  municipio: string | null; municipioIbge: string | null; uf: string | null; cep: string | null; regimeTributario: string | null; observacoes: string | null
}
interface Contato { id: string; tipo: string; valor: string; rotulo: string | null; principal: boolean }
interface Enquadramento { id: string; porte: string; dataReferencia: string; fonte: string; observacao: string | null }

const REGIMES = [
  { valor: 'MEI', rotulo: 'MEI' }, { valor: 'SIMPLES_NACIONAL', rotulo: 'Simples Nacional' },
  { valor: 'LUCRO_PRESUMIDO', rotulo: 'Lucro presumido' }, { valor: 'LUCRO_REAL', rotulo: 'Lucro real' },
]
const PORTES = [{ valor: 'MEI', rotulo: 'MEI' }, { valor: 'ME', rotulo: 'ME' }, { valor: 'EPP', rotulo: 'EPP' }, { valor: 'DEMAIS', rotulo: 'Demais' }]
const FONTES = [{ valor: 'declaracao', rotulo: 'Declaração' }, { valor: 'certidao_junta', rotulo: 'Certidão da Junta' }, { valor: 'outra', rotulo: 'Outra' }]
const TIPOS_CONTATO = [{ valor: 'email', rotulo: 'E-mail' }, { valor: 'telefone', rotulo: 'Telefone' }, { valor: 'whatsapp', rotulo: 'WhatsApp' }]

// Ficha da empresa (Prompt 2.1): dados gerais, endereço, contatos, CNAEs e enquadramento por data de referência.
export function EmpresaFicha({ empresaId, podeEditar }: { empresaId: string; podeEditar: boolean }) {
  const ficha = useGet<Ficha>(`/empresas/${empresaId}`)
  const cnaes = useGet<string[]>(`/empresas/${empresaId}/cnaes`)
  if (ficha.carregando) return <p className="legenda">Carregando…</p>
  return (
    <div className="pilha pilha--grande">
      <Aviso texto={ficha.erro} />
      {ficha.dados ? <DadosGerais empresaId={empresaId} ficha={ficha.dados} podeEditar={podeEditar} /> : null}
      <Cnaes empresaId={empresaId} lista={cnaes.dados ?? []} podeEditar={podeEditar} aoSalvar={cnaes.recarregar} />
      <Contatos empresaId={empresaId} podeEditar={podeEditar} />
      <Enquadramentos empresaId={empresaId} podeEditar={podeEditar} />
    </div>
  )
}

function DadosGerais({ empresaId, ficha, podeEditar }: { empresaId: string; ficha: Ficha; podeEditar: boolean }) {
  const [f, setF] = useState(() => ({ ...ficha }))
  const { enviando, erro, ok, enviar } = useEnvio()
  const set = (k: keyof Ficha) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  const campo = (rotulo: string, k: keyof Ficha, max = 200) => (
    <Campo rotulo={rotulo} value={f[k] ?? ''} onChange={(e) => set(k)(e.target.value)} maxLength={max} disabled={!podeEditar} autoComplete="off" />
  )
  const salvar = (e: FormEvent) => {
    e.preventDefault()
    return enviar(async () => {
      await chamar('PATCH', `/empresas/${empresaId}`, {
        razaoSocial: f.razaoSocial.trim(), nomeFantasia: ouNulo(f.nomeFantasia ?? ''), inscricaoEstadual: ouNulo(f.inscricaoEstadual ?? ''),
        inscricaoMunicipal: ouNulo(f.inscricaoMunicipal ?? ''), cnaePrincipal: ouNulo(f.cnaePrincipal ?? ''), logradouro: ouNulo(f.logradouro ?? ''),
        numero: ouNulo(f.numero ?? ''), complemento: ouNulo(f.complemento ?? ''), bairro: ouNulo(f.bairro ?? ''), municipio: ouNulo(f.municipio ?? ''),
        municipioIbge: ouNulo(f.municipioIbge ?? ''), uf: ouNulo(f.uf ?? ''), cep: ouNulo(f.cep ?? ''), regimeTributario: ouNulo(f.regimeTributario ?? ''),
        observacoes: ouNulo(f.observacoes ?? ''),
      })
      return 'Dados salvos.'
    })
  }
  return (
    <Secao titulo="Dados gerais">
      <form className="pilha" onSubmit={(e) => void salvar(e)}>
        <Campo rotulo="CNPJ" value={cnpjLegivel(ficha.cnpj)} readOnly disabled />
        {campo('Razão social', 'razaoSocial')}
        {campo('Nome fantasia', 'nomeFantasia')}
        {campo('Inscrição estadual', 'inscricaoEstadual', 30)}
        {campo('Inscrição municipal', 'inscricaoMunicipal', 30)}
        {campo('CNAE principal (7 dígitos)', 'cnaePrincipal', 9)}
        <Selecao rotulo="Regime tributário" value={f.regimeTributario ?? ''} onChange={set('regimeTributario')} opcoes={REGIMES} vazio="Não informado" disabled={!podeEditar} />
        <h3>Endereço</h3>
        {campo('Logradouro', 'logradouro')}
        {campo('Número', 'numero', 20)}
        {campo('Complemento', 'complemento', 100)}
        {campo('Bairro', 'bairro', 100)}
        {campo('Município', 'municipio', 100)}
        <Selecao rotulo="UF" value={f.uf ?? ''} onChange={set('uf')} opcoes={opcoesUf} vazio="—" disabled={!podeEditar} />
        {campo('CEP', 'cep', 9)}
        <label className="campo">
          <span className="campo__rotulo">Observações</span>
          <textarea className="campo__entrada" rows={3} maxLength={4000} value={f.observacoes ?? ''} disabled={!podeEditar} onChange={(e) => set('observacoes')(e.target.value)} />
        </label>
        <Aviso texto={erro} />
        <Aviso tipo="info" texto={ok} />
        {podeEditar ? <Botao type="submit" carregando={enviando}>Salvar dados</Botao> : null}
      </form>
    </Secao>
  )
}

function Cnaes({ empresaId, lista, podeEditar, aoSalvar }: { empresaId: string; lista: string[]; podeEditar: boolean; aoSalvar: () => void }) {
  const [texto, setTexto] = useState(lista.join(', '))
  const { enviando, erro, ok, enviar } = useEnvio()
  return (
    <Secao titulo="CNAEs secundários">
      <Campo rotulo="Códigos separados por vírgula" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!podeEditar} />
      <Aviso texto={erro} />
      <Aviso tipo="info" texto={ok} />
      {podeEditar ? (
        <Botao
          carregando={enviando}
          onClick={() =>
            void enviar(async () => {
              await chamar('PUT', `/empresas/${empresaId}/cnaes`, { cnaes: texto.split(/[,\s;]+/).filter(Boolean) })
              aoSalvar()
              return 'CNAEs salvos.'
            })
          }
        >
          Salvar CNAEs
        </Botao>
      ) : null}
    </Secao>
  )
}

function Contatos({ empresaId, podeEditar }: { empresaId: string; podeEditar: boolean }) {
  const lista = useGet<Contato[]>(`/empresas/${empresaId}/contatos`)
  const [tipo, setTipo] = useState('email')
  const [valor, setValor] = useState('')
  const [rotulo, setRotulo] = useState('')
  const [principal, setPrincipal] = useState(false)
  const { enviando, erro, enviar } = useEnvio()
  const incluir = (e: FormEvent) => {
    e.preventDefault()
    return enviar(async () => {
      await chamar('POST', `/empresas/${empresaId}/contatos`, { tipo, valor: valor.trim(), rotulo: ouNulo(rotulo), principal })
      setValor('')
      setRotulo('')
      setPrincipal(false)
      lista.recarregar()
    })
  }
  return (
    <Secao titulo="Contatos">
      <Aviso texto={lista.erro} />
      {lista.dados?.length === 0 ? <p className="legenda">Nenhum contato cadastrado.</p> : null}
      <div className="lista">
        {lista.dados?.map((c) => (
          <div key={c.id} className="lista__item lista__item--acoes" style={{ cursor: 'default' }}>
            <span className="lista__texto">
              <strong>{c.valor}</strong>
              <span className="legenda">{[TIPOS_CONTATO.find((t) => t.valor === c.tipo)?.rotulo, c.rotulo, c.principal ? 'principal' : null].filter(Boolean).join(' · ')}</span>
            </span>
            {podeEditar ? (
              <Botao variante="texto" onClick={() => void chamar('DELETE', `/empresas/${empresaId}/contatos/${c.id}`).then(lista.recarregar)}>
                Remover
              </Botao>
            ) : null}
          </div>
        ))}
      </div>
      {podeEditar ? (
        <form className="pilha" onSubmit={(e) => void incluir(e)}>
          <Selecao rotulo="Tipo" value={tipo} onChange={setTipo} opcoes={TIPOS_CONTATO} />
          <Campo rotulo="Valor (e-mail ou telefone com DDD)" value={valor} onChange={(e) => setValor(e.target.value)} maxLength={254} />
          <Campo rotulo="Rótulo (opcional)" value={rotulo} onChange={(e) => setRotulo(e.target.value)} maxLength={50} />
          <Caixa rotulo="Principal deste tipo" marcado={principal} onChange={setPrincipal} />
          <Aviso texto={erro} />
          <Botao type="submit" variante="secundario" carregando={enviando}>
            Incluir contato
          </Botao>
        </form>
      ) : null}
    </Secao>
  )
}

function Enquadramentos({ empresaId, podeEditar }: { empresaId: string; podeEditar: boolean }) {
  const lista = useGet<Enquadramento[]>(`/empresas/${empresaId}/enquadramentos`)
  const [porte, setPorte] = useState('EPP')
  const [data, setData] = useState('')
  const [fonte, setFonte] = useState('declaracao')
  const { enviando, erro, enviar } = useEnvio()
  const incluir = (e: FormEvent) => {
    e.preventDefault()
    return enviar(async () => {
      try {
        await chamar('POST', `/empresas/${empresaId}/enquadramentos`, { porte, dataReferencia: data, fonte })
      } catch (er) {
        if (er instanceof ErroApi && er.status === 409) throw new ErroApi(409, 'Já existe enquadramento para essa data de referência.')
        throw er
      }
      setData('')
      lista.recarregar()
    })
  }
  return (
    <Secao titulo="Enquadramento (porte) por data de referência">
      <p className="legenda">O histórico só recebe inclusões: o porte vale pela data de referência informada. ⚖️🧾 A lista de portes será confirmada pelo contador.</p>
      <Aviso texto={lista.erro} />
      <div className="lista">
        {lista.dados?.map((x) => (
          <div key={x.id} className="lista__item" style={{ cursor: 'default' }}>
            <span className="lista__texto">
              <strong>{PORTES.find((p) => p.valor === x.porte)?.rotulo ?? x.porte}</strong>
              <span className="legenda">A partir de {dataBr(x.dataReferencia)} · {FONTES.find((f) => f.valor === x.fonte)?.rotulo}</span>
            </span>
          </div>
        ))}
      </div>
      {podeEditar ? (
        <form className="pilha" onSubmit={(e) => void incluir(e)}>
          <Selecao rotulo="Porte" value={porte} onChange={setPorte} opcoes={PORTES} />
          <Campo rotulo="Data de referência" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <Selecao rotulo="Fonte" value={fonte} onChange={setFonte} opcoes={FONTES} />
          <Aviso texto={erro} />
          <Botao type="submit" variante="secundario" carregando={enviando}>
            Registrar enquadramento
          </Botao>
        </form>
      ) : null}
    </Secao>
  )
}
