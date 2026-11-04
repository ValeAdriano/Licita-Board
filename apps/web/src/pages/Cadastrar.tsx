import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { chamar, ErroApi } from '../api/cliente'
import { useSessao } from '../auth/sessao'
import { problemaNaNovaSenha } from '../auth/links'
import { cnpjValido, normalizarCnpj } from '../features/acesso/cnpj'
import { Aviso, Botao, Campo, TelaAcesso } from '../ui'

// Cadastro: a pessoa cria a conta e a empresa dela (razão social e CNPJ) e entra direto; no primeiro
// acesso cadastra o autenticador (MFA). A API só atende com o cadastro aberto.
export default function Cadastrar() {
  const { entrar } = useSessao()
  const [f, setF] = useState({ nome: '', email: '', razaoSocial: '', cnpj: '', senha: '', confirmar: '' })
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (f.nome.trim().length < 2) return setErro('Informe seu nome.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setErro('Informe um e-mail válido.')
    if (f.razaoSocial.trim().length < 2) return setErro('Informe a razão social da empresa.')
    if (!cnpjValido(f.cnpj)) return setErro('CNPJ inválido.')
    const problema = problemaNaNovaSenha(f.senha, f.confirmar)
    if (problema) return setErro(problema)
    setEnviando(true)
    setErro(null)
    try {
      await chamar('POST', '/auth/cadastro', {
        nome: f.nome.trim(),
        email: f.email.trim(),
        razaoSocial: f.razaoSocial.trim(),
        cnpj: normalizarCnpj(f.cnpj),
        senha: f.senha,
      })
      await entrar(f.email.trim(), f.senha)
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.')
      setEnviando(false)
    }
  }

  return (
    <TelaAcesso titulo="Criar conta">
      <form className="flex flex-col gap-4" onSubmit={(e) => void enviar(e)} noValidate>
        <Campo rotulo="Seu nome" value={f.nome} onChange={(v) => setF({ ...f, nome: v })} autoComplete="name" maxLength={120} />
        <Campo rotulo="E-mail" type="email" value={f.email} onChange={(v) => setF({ ...f, email: v })} autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} />
        <Campo rotulo="Razão social da empresa" value={f.razaoSocial} onChange={(v) => setF({ ...f, razaoSocial: v })} autoComplete="organization" maxLength={200} />
        <Campo rotulo="CNPJ da empresa" value={f.cnpj} onChange={(v) => setF({ ...f, cnpj: v })} inputMode="text" maxLength={18} autoCapitalize="characters" spellCheck={false} />
        <Campo rotulo="Senha" type="password" value={f.senha} onChange={(v) => setF({ ...f, senha: v })} autoComplete="new-password" dica="Pelo menos 8 caracteres e um caractere especial (como ! @ # $ % -)." />
        <Campo rotulo="Repita a senha" type="password" value={f.confirmar} onChange={(v) => setF({ ...f, confirmar: v })} autoComplete="new-password" />
        <Aviso texto={erro} />
        <Botao type="submit" cheio carregando={enviando}>
          Criar conta
        </Botao>
      </form>
      <p className="text-center text-sm text-tertiary">No primeiro acesso você cadastra o autenticador (MFA) para proteger a conta.</p>
      <Link to="/entrar" className="text-center text-sm text-tertiary">
        Já tenho conta
      </Link>
    </TelaAcesso>
  )
}
