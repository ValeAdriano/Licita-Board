import { Link } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { ErroApi } from '../../api/cliente';
import { precisaCaptcha, useSessao } from '../../auth/sessao';
import { Captcha } from '../../ui/Captcha';
import { Botao, Campo, Mensagem, Tela } from '../../ui/formulario';

export default function Entrar() {
  const { entrar } = useSessao();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<{ pedido: boolean; token?: string }>({ pedido: false });
  const [enviando, setEnviando] = useState(false);
  const aoResolver = useCallback((token: string) => setCaptcha({ pedido: true, token }), []);

  async function enviar() {
    if (!email.trim() || !senha) return setErro('Informe e-mail e senha.');
    setEnviando(true);
    setErro(null);
    try {
      await entrar(email.trim(), senha, captcha.token);
      // O script do Turnstile não fica na página da sessão aberta (ele teria acesso ao CSRF): recarga
      // completa, e a sessão volta pelo cookie.
      if (Platform.OS === 'web' && captcha.pedido) window.location.replace('/');
    } catch (e) {
      if (precisaCaptcha(e)) {
        setCaptcha({ pedido: true });
        setErro('Confirme a verificação abaixo e tente de novo.');
      } else {
        setErro(e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.');
        if (captcha.pedido) setCaptcha({ pedido: true });
      }
      setSenha('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Tela titulo="Entrar">
      <Campo rotulo="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="username" />
      <Campo rotulo="Senha" value={senha} onChangeText={setSenha} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={() => void enviar()} />
      {captcha.pedido && !captcha.token ? <Captcha aoResolver={aoResolver} /> : null}
      <Mensagem texto={erro} />
      <Botao texto="Entrar" onPress={() => void enviar()} carregando={enviando} />
      <Link href="/recuperar" style={{ color: '#1D4ED8', textAlign: 'center', padding: 12 }}>
        Esqueci minha senha
      </Link>
    </Tela>
  );
}
