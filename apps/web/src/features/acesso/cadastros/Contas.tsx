import { useState, type FormEvent } from 'react'
import { chamar, ErroApi } from '../../../api/cliente'
import { useSessao } from '../../../auth/sessao'
import { Aviso, Botao, Campo } from '../../../ui'
import { Secao } from '../conta/Secao'
import { StepUpModal } from '../equipe/StepUpModal'
import { useGet } from '../useGet'
import { Caixa, ouNulo, Selecao, useValorTemporario } from './comum'

interface Conta {
  id: string; banco: string; tipoConta: string; titularNome: string; pixTipo: string | null
  agenciaMascara: string; contaMascara: string; titularDocumentoMascara: string; pixMascara: string | null; principal: boolean
}
const TIPOS = [{ valor: 'corrente', rotulo: 'Corrente' }, { valor: 'poupanca', rotulo: 'Poupança' }, { valor: 'pagamento', rotulo: 'Pagamento' }]
const PIX = [{ valor: 'cpf', rotulo: 'CPF' }, { valor: 'cnpj', rotulo: 'CNPJ' }, { valor: 'email', rotulo: 'E-mail' }, { valor: 'telefone', rotulo: 'Telefone' }, { valor: 'aleatoria', rotulo: 'Chave aleatória' }]
const CAMPOS = [
  { campo: 'agencia', rotulo: 'Agência' }, { campo: 'conta', rotulo: 'Conta' },
  { campo: 'titular_documento', rotulo: 'Documento do titular' }, { campo: 'pix_chave', rotulo: 'Chave PIX' },
]

type Pendente = { resumo: string[]; acao: (stepUp: string) => Promise<void> } | null

// Dados bancários e PIX (ADR-017): cifrados na API; aqui só máscara. Cadastrar, remover e revelar pedem
// o código do autenticador (step-up), e os administradores da empresa são avisados.
export function Contas({ empresaId, podeEditar }: { empresaId: string; podeEditar: boolean }) {
  const lista = useGet<Conta[]>(`/empresas/${empresaId}/contas`)
  const { valor, mostrar, esconder } = useValorTemporario()
  const [pendente, setPendente] = useState<Pendente>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)
  const { stepUp: _s } = useSessao()
  void _s

  const confirmar = async (stepUp: string) => {
    if (!pendente) return
    try {
      await pendente.acao(stepUp)
      setPendente(null)
    } catch (e) {
      setPendente(null)
      setErro(`${e instanceof ErroApi ? e.message : 'Não foi possível concluir.'} O código já foi usado: aguarde o próximo para tentar de novo.`)
    }
  }
  const revelar = (c: Conta, campo: string, rotulo: string) =>
    setPendente({
      resumo: [`Mostrar por inteiro: ${rotulo}`, `Conta de ${c.titularNome}`],
      acao: async (su) => {
        const r = await chamar<{ valor: string }>('POST', `/empresas/${empresaId}/contas/${c.id}/revelar`, { campo, stepUp: su })
        mostrar(`${c.id}:${campo}`, r.valor)
      },
    })
  const remover = (c: Conta) =>
    setPendente({
      resumo: [`Remover a conta de ${c.titularNome}`, `Banco ${c.banco}`],
      acao: async (su) => {
        await chamar('POST', `/empresas/${empresaId}/contas/${c.id}/remover`, { stepUp: su })
        lista.recarregar()
      },
    })

  return (
    <Secao titulo="Dados bancários e PIX">
      <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Guardados cifrados. Alterar ou ver por inteiro pede o código do autenticador e avisa os administradores.</p>
      <Aviso texto={erro ?? lista.erro} />
      {lista.dados?.length === 0 ? <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Nenhuma conta cadastrada.</p> : null}
      <div className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
        {lista.dados?.map((c) => (
          <div key={c.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left flex-wrap items-start">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
              <strong>
                <bdi>{c.titularNome}</bdi> {c.principal ? '· principal' : ''}
              </strong>
              <span className="text-sm text-tertiary [overflow-wrap:anywhere]">Banco {c.banco} · {TIPOS.find((t) => t.valor === c.tipoConta)?.rotulo}</span>
              {CAMPOS.map(({ campo, rotulo }) => {
                const mascara = campo === 'agencia' ? c.agenciaMascara : campo === 'conta' ? c.contaMascara : campo === 'titular_documento' ? c.titularDocumentoMascara : c.pixMascara
                if (!mascara) return null
                const aberto = valor?.chave === `${c.id}:${campo}`
                return (
                  <span key={campo} className="text-sm text-tertiary [overflow-wrap:anywhere]">
                    {rotulo}: <strong>{aberto ? valor.texto : mascara}</strong>{' '}
                    {podeEditar ? (
                      <Botao variante="texto" onClick={() => (aberto ? esconder() : revelar(c, campo, rotulo))}>
                        {aberto ? 'Ocultar' : 'Mostrar'}
                      </Botao>
                    ) : null}
                  </span>
                )
              })}
            </span>
            {podeEditar ? (
              <Botao variante="texto" onClick={() => remover(c)}>
                Remover
              </Botao>
            ) : null}
          </div>
        ))}
      </div>
      {podeEditar ? (
        novo ? (
          <NovaConta empresaId={empresaId} aoCancelar={() => setNovo(false)} aoPedir={(resumo, acao) => setPendente({ resumo, acao: async (su) => { await acao(su); setNovo(false); lista.recarregar() } })} />
        ) : (
          <Botao variante="secundario" onClick={() => setNovo(true)}>
            Cadastrar conta
          </Botao>
        )
      ) : null}
      <StepUpModal
        aberto={pendente !== null}
        escopo="dados_bancarios"
        descricao="Dado bancário é sensível: confirme com o código do autenticador."
        resumo={pendente?.resumo ?? []}
        aoConfirmar={confirmar}
        aoCancelar={() => setPendente(null)}
      />
    </Secao>
  )
}

function NovaConta(props: { empresaId: string; aoCancelar: () => void; aoPedir: (resumo: string[], acao: (stepUp: string) => Promise<void>) => void }) {
  const [f, setF] = useState({ banco: '', tipoConta: 'corrente', titularNome: '', agencia: '', conta: '', titularDocumento: '', pixTipo: '', pixChave: '', principal: false })
  const [erro, setErro] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }))
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    if (!/^\d{3}$/.test(f.banco)) return setErro('O banco tem 3 dígitos (código COMPE).')
    if (f.pixTipo && !f.pixChave.trim()) return setErro('Informe a chave PIX ou escolha "Sem PIX".')
    setErro(null)
    props.aoPedir([`Cadastrar conta de ${f.titularNome}`, `Banco ${f.banco}`, f.pixTipo ? 'Com chave PIX' : 'Sem PIX'], async (stepUp) => {
      await chamar('POST', `/empresas/${props.empresaId}/contas`, {
        banco: f.banco, tipoConta: f.tipoConta, titularNome: f.titularNome.trim(), agencia: f.agencia.trim(), conta: f.conta.trim(),
        titularDocumento: f.titularDocumento.trim(), ...(f.pixTipo ? { pixTipo: f.pixTipo, pixChave: f.pixChave.trim() } : {}), principal: f.principal, stepUp,
      })
    })
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={enviar} noValidate>
      <Campo rotulo="Banco (código, 3 dígitos)" value={f.banco} onChange={(v) => set('banco')(v)} maxLength={3} inputMode="numeric" />
      <Selecao rotulo="Tipo de conta" value={f.tipoConta} onChange={set('tipoConta')} opcoes={TIPOS} />
      <Campo rotulo="Titular" value={f.titularNome} onChange={(v) => set('titularNome')(v)} maxLength={200} />
      <Campo rotulo="CPF ou CNPJ do titular" value={f.titularDocumento} onChange={(v) => set('titularDocumento')(v)} maxLength={18} autoComplete="off" />
      <Campo rotulo="Agência" value={f.agencia} onChange={(v) => set('agencia')(v)} maxLength={7} autoComplete="off" />
      <Campo rotulo="Conta (com dígito)" value={f.conta} onChange={(v) => set('conta')(v)} maxLength={14} autoComplete="off" />
      <Selecao rotulo="Tipo da chave PIX" value={f.pixTipo} onChange={set('pixTipo')} opcoes={PIX} vazio="Sem PIX" />
      {f.pixTipo ? <Campo rotulo="Chave PIX" value={f.pixChave} onChange={(v) => set('pixChave')(v)} maxLength={120} autoComplete="off" /> : null}
      <Caixa rotulo="Conta principal" marcado={f.principal} onChange={set('principal') as (v: boolean) => void} />
      <Aviso texto={erro} />
      <Botao type="submit">Continuar</Botao>
      <Botao variante="texto" onClick={props.aoCancelar}>
        Cancelar
      </Botao>
    </form>
  )
}

export { ouNulo }
