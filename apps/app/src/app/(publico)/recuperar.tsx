import { Link } from 'expo-router';
import { useCallback, useState } from 'react';
import { chamar, ErroApi } from '../../api/cliente';
import { precisaCaptcha } from '../../auth/sessao';
import { Captcha } from '../../ui/Captcha';
import { Botao, Campo, Mensagem, Tela } from '../../ui/formulario';

// Resposta sempre igual, exista ou não a conta (RF-01.11): a tela não sabe e não diz.
export default function Recuperar() {
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [captcha, setCaptcha] = useState<{ pedido: boolean; token?: string }>({ pedido: false });
  const [enviando, setEnviando] = useState(false);
  const aoResolver = useCallback((token: string) => setCaptcha({ pedido: true, token }), []);

  async function enviar() {
    if (!email.trim()) return setErro('Informe o e-mail.');
    setEnviando(true);
    setErro(null);
    try {
      await chamar('POST', '/auth/recuperar', { email: email.trim(), captcha: captcha.token });
      setEnviado(true);
    } catch (e) {
      if (precisaCaptcha(e)) setErro('Confirme a verificação abaixo e tente de novo.');
      else setErro(e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.');
      setCaptcha({ pedido: captcha.pedido || precisaCaptcha(e) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Tela titulo="Recuperar senha">
      {enviado ? (
        <Mensagem tipo="info" texto="Se o e-mail estiver cadastrado, enviaremos um link em instantes. Ele vale por 30 minutos." />
      ) : (
        <>
          <Campo rotulo="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
          {captcha.pedido && !captcha.token ? <Captcha aoResolver={aoResolver} /> : null}
          <Mensagem texto={erro} />
          <Botao texto="Enviar link" onPress={() => void enviar()} carregando={enviando} />
        </>
      )}
      <Link href="/entrar" style={{ color: '#1D4ED8', textAlign: 'center', padding: 12 }}>
        Voltar para entrar
      </Link>
    </Tela>
  );
}
