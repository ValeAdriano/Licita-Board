import { mensagemSair, useSessao } from '../auth/sessao'
import { useAcesso } from '../features/acesso/contexto'
import { Autenticador } from '../features/acesso/conta/Autenticador'
import { Perfil } from '../features/acesso/conta/Perfil'
import { Senha } from '../features/acesso/conta/Senha'
import { Sessoes } from '../features/acesso/conta/Sessoes'
import { useEnvio } from '../features/acesso/conta/useEnvio'
import { Aviso, Botao } from '../ui'

export default function Conta() {
  const { usuario } = useAcesso()
  const { sair } = useSessao()
  const { erro, setErro } = useEnvio()
  return (
    <div className="conteudo__miolo entra">
      <h1>Conta</h1>
      {usuario ? (
        <>
          <Perfil key={usuario.id} usuario={usuario} />
          <Senha temMfa={usuario.temMfa} />
          <Autenticador usuario={usuario} />
        </>
      ) : null}
      <Sessoes />
      <Aviso texto={erro} />
      <Botao variante="secundario" onClick={() => void sair().catch((e: unknown) => setErro(mensagemSair(e)))}>
        Sair
      </Botao>
    </div>
  )
}
