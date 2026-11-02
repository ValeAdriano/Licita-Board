import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Aviso, Botao, Card, TelaCentral } from '../../components/ui'
import { useAuth } from '../../lib/auth/AuthProvider'
import { mensagemDeErro } from '../../lib/auth/erros'
import { supabase } from '../../lib/supabase'
import { CodigoMfa } from '../../components/CodigoMfa'

type Cadastro = { factorId: string; qrCode: string; segredo: string }

// MFA obrigatório para perfis internos (Prompt 1.4). O QR vem do Supabase como data URL de SVG
// e é exibido em <img>, nunca injetado como HTML.
export function MfaCadastroPage() {
  const { recarregar, sair } = useAuth()
  const navigate = useNavigate()
  const [cadastro, setCadastro] = useState<Cadastro | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)

  async function gerar() {
    setErro(null)
    setGerando(true)
    // Tentativas abandonadas deixam fatores não verificados; removê-los evita conflito no cadastro.
    const { data: fatores } = await supabase.auth.mfa.listFactors()
    for (const f of fatores?.all ?? []) {
      if (f.factor_type === 'totp' && f.status === 'unverified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Autenticador ${new Date().toISOString().slice(0, 10)}`,
    })
    setGerando(false)
    if (error || !data) {
      setErro(mensagemDeErro(error))
      return
    }
    setCadastro({ factorId: data.id, qrCode: data.totp.qr_code, segredo: data.totp.secret })
  }

  return (
    <TelaCentral>
      <Card titulo="Ative a verificação em duas etapas">
        <p className="mb-4 text-sm">
          Seu perfil exige um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password…).
        </p>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!cadastro ? (
          <Botao onClick={gerar} disabled={gerando}>
            {gerando ? 'Gerando…' : 'Gerar QR code'}
          </Botao>
        ) : (
          <>
            <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
              <li>Escaneie o QR code no aplicativo.</li>
              <li>Digite o código de 6 números que aparecer.</li>
            </ol>
            <img src={cadastro.qrCode} alt="QR code para o aplicativo autenticador" className="mx-auto mb-3 size-48 rounded bg-white p-2" />
            <details className="mb-4 text-sm">
              <summary className="cursor-pointer">Não consigo escanear</summary>
              <p className="mt-2 break-all font-mono text-xs">{cadastro.segredo}</p>
            </details>
            <CodigoMfa
              rotuloBotao="Ativar"
              aoEnviar={async (codigo) => {
                const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: cadastro.factorId, code: codigo })
                if (error) return mensagemDeErro(error)
                await recarregar()
                navigate('/', { replace: true })
                return null
              }}
            />
          </>
        )}
        <div className="mt-4">
          <Botao variante="secundario" onClick={() => void sair()}>
            Sair
          </Botao>
        </div>
      </Card>
    </TelaCentral>
  )
}
