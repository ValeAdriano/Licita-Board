import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { chamar, ErroApi } from '../api/cliente'
import { useSessao } from '../auth/sessao'
import { Aviso, Botao, Campo, TelaAcesso } from '../ui'

// Conta de TESTE (só desenvolvimento, ver core.cadastrar_conta_teste): cria o usuário com uma empresa
// FICTÍCIA para usar o sistema à mão. Depois de criar, entra direto; o primeiro acesso pede o MFA.
export default function Cadastrar() {
  const { entrar } = useSessao()
  const [f, setF] = useState({ nome: '', email: '', senha: '', confirmar: '' })
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (f.nome.trim().length < 2) return setErro('Informe seu nome.')
    if (!f.email.trim()) return setErro('Informe um e-mail.')
    if (f.senha.length < 12) return setErro('A senha precisa de pelo menos 12 caracteres.')
    if (f.senha !== f.confirmar) return setErro('As senhas não conferem.')
    setEnviando(true)
    setErro(null)
    try {
      await chamar('POST', '/auth/cadastro-teste', { nome: f.nome.trim(), email: f.email.trim(), senha: f.senha })
      await entrar(f.email.trim(), f.senha)
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.')
      setEnviando(false)
    }
  }

  return (
    <TelaAcesso titulo="Criar conta de teste">
      <Aviso tipo="atencao" texto="Só para desenvolvimento: cria uma empresa fictícia e você como administrador. No primeiro acesso você cadastra o autenticador (MFA)." />
      <form className="flex flex-col gap-4" onSubmit={(e) => void enviar(e)} noValidate>
        <Campo rotulo="Nome" value={f.nome} onChange={(v) => setF({ ...f, nome: v })} autoComplete="name" maxLength={120} />
        <Campo rotulo="E-mail" type="email" value={f.email} onChange={(v) => setF({ ...f, email: v })} autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} />
        <Campo rotulo="Senha (12 caracteres ou mais)" type="password" value={f.senha} onChange={(v) => setF({ ...f, senha: v })} autoComplete="new-password" />
        <Campo rotulo="Repita a senha" type="password" value={f.confirmar} onChange={(v) => setF({ ...f, confirmar: v })} autoComplete="new-password" />
        <Aviso texto={erro} />
        <Botao type="submit" cheio carregando={enviando}>
          Criar conta e entrar
        </Botao>
      </form>
      <Link to="/entrar" className="text-center text-sm text-tertiary">
        Já tenho conta
      </Link>
    </TelaAcesso>
  )
}
