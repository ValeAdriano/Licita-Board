import { useState, type FormEvent } from 'react'
import { chamar, ErroApi } from '../../../api/cliente'
import { Aviso, Botao, Campo } from '../../../ui'
import { cnpjValido, normalizarCnpj } from '../cnpj'

// Cadastro de empresa cliente (Prompt 1.2, só SUPERADMIN: a API recusa os demais). Os demais dados
// da empresa chegam na Fase 02. O administrador dela entra depois, por convite, na aba Equipe.
export function NovaEmpresa(props: { aoConcluir: () => void; aoCancelar: () => void }) {
  const [razao, setRazao] = useState('')
  const [fantasia, setFantasia] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (razao.trim().length < 2) return setErro('Informe a razão social.')
    if (!cnpjValido(cnpj)) return setErro('CNPJ inválido. Confira os 14 caracteres e os dois últimos dígitos.')
    setErro(null)
    setEnviando(true)
    try {
      await chamar('POST', '/empresas', {
        razaoSocial: razao.trim(),
        ...(fantasia.trim() ? { nomeFantasia: fantasia.trim() } : {}),
        cnpj: normalizarCnpj(cnpj),
      })
      props.aoConcluir()
    } catch (e2) {
      setErro(e2 instanceof ErroApi ? e2.message : 'Não foi possível cadastrar. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => void salvar(e)} noValidate>
      <h2>Nova empresa</h2>
      <Campo rotulo="Razão social" value={razao} onChange={(v) => setRazao(v)} maxLength={200} autoComplete="off" />
      <Campo rotulo="Nome fantasia (opcional)" value={fantasia} onChange={(v) => setFantasia(v)} maxLength={200} autoComplete="off" />
      <Campo rotulo="CNPJ" value={cnpj} onChange={(v) => setCnpj(v)} maxLength={18} autoComplete="off" spellCheck={false} />
      <Aviso texto={erro} />
      <Botao type="submit" cheio carregando={enviando}>
        Cadastrar empresa
      </Botao>
      <Botao variante="texto" onClick={props.aoCancelar}>
        Cancelar
      </Botao>
    </form>
  )
}
