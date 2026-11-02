import { useNavigate } from 'react-router'
import { Botao, Card, TelaCentral } from '../../components/ui'
import { useAuth } from '../../lib/auth/AuthProvider'
import { mensagemDeErro } from '../../lib/auth/erros'
import { supabase } from '../../lib/supabase'
import { CodigoMfa } from '../../components/CodigoMfa'

export function MfaVerificarPage() {
  const { fatorVerificadoId, recarregar, sair } = useAuth()
  const navigate = useNavigate()

  return (
    <TelaCentral>
      <Card titulo="Verificação em duas etapas">
        <p className="mb-4 text-sm">Abra o aplicativo autenticador e digite o código de 6 números.</p>
        <CodigoMfa
          aoEnviar={async (codigo) => {
            if (!fatorVerificadoId) return 'Nenhum autenticador cadastrado.'
            const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fatorVerificadoId, code: codigo })
            if (error) return mensagemDeErro(error)
            await recarregar()
            navigate('/', { replace: true })
            return null
          }}
        />
        <div className="mt-4">
          <Botao variante="secundario" onClick={() => void sair()}>
            Sair
          </Botao>
        </div>
      </Card>
    </TelaCentral>
  )
}
