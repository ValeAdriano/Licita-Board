import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { chamar, ErroApi } from '../../api/cliente';
import { descartarTokenWeb, tokenWebCapturado } from '../../auth/fragmento';
import { problemaNaNovaSenha, tokenDoFragmento } from '../../auth/links';
import { Botao, Campo, Mensagem, Tela } from '../../ui/formulario';

// Aberta pelo link do e-mail (`/redefinir-senha#token=...`). No web, o token já saiu da URL no
// carregamento (src/auth/fragmento.ts); no nativo vem do deep link, no parâmetro `#` do roteador.
export default function RedefinirSenha() {
  const { '#': fragmento } = useLocalSearchParams<{ '#'?: string }>();
  const [token] = useState(() => tokenWebCapturado() ?? tokenDoFragmento(fragmento ? `#${fragmento}` : null));
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    const problema = problemaNaNovaSenha(senha, confirmacao);
    if (problema) return setErro(problema);
    setEnviando(true);
    setErro(null);
    try {
      await chamar('POST', '/auth/redefinir', { token, senha });
      descartarTokenWeb();
      setPronto(true);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Tela titulo="Nova senha">
      {pronto ? (
        <Mensagem tipo="info" texto="Senha redefinida. As sessões abertas foram encerradas; entre com a nova senha." />
      ) : !token ? (
        <Mensagem texto="Link inválido ou incompleto. Peça um novo em “Esqueci minha senha”." />
      ) : (
        <>
          <Campo rotulo="Nova senha" value={senha} onChangeText={setSenha} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
          <Campo rotulo="Repita a nova senha" value={confirmacao} onChangeText={setConfirmacao} secureTextEntry autoComplete="new-password" />
          <Mensagem texto={erro} />
          <Botao texto="Salvar nova senha" onPress={() => void enviar()} carregando={enviando} />
        </>
      )}
      <Link href="/entrar" style={{ color: '#1D4ED8', textAlign: 'center', padding: 12 }}>
        Ir para entrar
      </Link>
    </Tela>
  );
}
