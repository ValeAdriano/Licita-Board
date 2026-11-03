import { useState, type FormEvent } from 'react'
import { chamar } from '../../../api/cliente'
import { Aviso, Botao, Campo } from '../../../ui'
import { useAcesso, type Usuario } from '../contexto'
import { Secao } from './Secao'
import { useEnvio } from './useEnvio'

export function Perfil({ usuario }: { usuario: Usuario }) {
  const { recarregar } = useAcesso()
  const [nome, setNome] = useState(usuario.nome)
  const [telefone, setTelefone] = useState(usuario.telefone ?? '')
  const [oab, setOab] = useState(usuario.oab ?? '')
  const { enviando, erro, ok, enviar } = useEnvio()

  const salvar = (e: FormEvent) => {
    e.preventDefault()
    return enviar(async () => {
      await chamar('PATCH', '/me', { nome: nome.trim(), telefone: telefone.trim() || null, oab: oab.trim() || null })
      await recarregar()
      return 'Dados salvos.'
    })
  }

  return (
    <Secao titulo="Seus dados">
      <form className="pilha" onSubmit={(e) => void salvar(e)}>
        <Campo rotulo="E-mail" value={usuario.email} readOnly disabled />
        <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={200} autoComplete="name" />
        <Campo rotulo="Telefone" type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} maxLength={30} autoComplete="tel" />
        <Campo rotulo="OAB" value={oab} onChange={(e) => setOab(e.target.value)} maxLength={30} />
        <Aviso texto={erro} />
        <Aviso tipo="info" texto={ok} />
        <Botao type="submit" carregando={enviando}>
          Salvar dados
        </Botao>
      </form>
    </Secao>
  )
}
