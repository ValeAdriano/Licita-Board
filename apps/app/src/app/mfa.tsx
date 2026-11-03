import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { chamar, ErroApi } from '../api/cliente';
import { segredoDaUri } from '../auth/links';
import { mensagemSair, useSessao, type Elevacao } from '../auth/sessao';
import { Botao, Campo, Mensagem, Tela } from '../ui/formulario';
import { SemCaptura } from '../ui/SemCaptura';

// Segundo fator (RF-01.10). Primeiro acesso de perfil interno: cadastra o autenticador (com a senha
// de novo), confirma o código e mostra os 10 códigos de recuperação uma única vez.
export default function Mfa() {
  const { mfa, cadastrarTotp, elevar, concluirMfa, sair } = useSessao();
  const [uri, setUri] = useState<string | null>(null);
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [usarRecuperacao, setUsarRecuperacao] = useState(false);
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function tentar(acao: () => Promise<void>) {
    setEnviando(true);
    setErro(null);
    try {
      await acao();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  const iniciarCadastro = () =>
    tentar(async () => {
      const r = await cadastrarTotp(senha);
      setSenha('');
      setUri(r.uri);
    });

  // Os códigos saem numa chamada separada: se ela falhar, a sessão já está em aal2 e a tela só
  // oferece gerar de novo (outro TOTP aqui contaria como erro e poderia bloquear o MFA).
  const gerarCodigos = () =>
    tentar(async () => {
      const r = await chamar<{ codigos: string[] }>('POST', '/auth/mfa/codigos');
      setCodigos(r.codigos);
    });

  const confirmar = () =>
    tentar(async () => {
      const tipo: Elevacao = mfa === 'cadastrar' ? 'confirmar' : usarRecuperacao ? 'recuperacao' : 'verificar';
      await elevar(tipo, codigo.trim());
      setCodigo('');
      if (tipo !== 'confirmar') return concluirMfa();
      setConfirmado(true);
      await gerarCodigos();
    });

  const sairComAviso = () => void sair().catch((e: unknown) => setErro(mensagemSair(e)));

  if (codigos) {
    return (
      <Tela titulo="Códigos de recuperação">
        <SemCaptura />
        <Text>Guarde em lugar seguro antes de sair desta tela. Cada código vale uma vez, se você perder o autenticador. Eles não serão mostrados de novo.</Text>
        <View style={estilos.codigos}>
          {codigos.map((c) => (
            <Text key={c} selectable style={estilos.mono}>
              {c.match(/.{1,5}/g)?.join('-')}
            </Text>
          ))}
        </View>
        <Botao texto="Guardei os códigos" onPress={concluirMfa} />
      </Tela>
    );
  }

  if (confirmado) {
    return (
      <Tela titulo="Autenticador cadastrado">
        <Text>Falta gerar os códigos de recuperação, para entrar se você perder o celular.</Text>
        <Mensagem texto={erro} />
        <Botao texto="Gerar códigos" onPress={() => void gerarCodigos()} carregando={enviando} />
        <Botao secundario texto="Continuar sem os códigos" onPress={concluirMfa} />
      </Tela>
    );
  }

  const cadastrando = mfa === 'cadastrar';
  return (
    <Tela titulo={cadastrando ? 'Cadastrar autenticador' : 'Verificação em duas etapas'}>
      {cadastrando && !uri ? (
        <>
          <Text>Seu perfil exige um app autenticador (Google Authenticator, Microsoft Authenticator, 1Password...). Confirme sua senha para começar.</Text>
          <Campo rotulo="Senha" value={senha} onChangeText={setSenha} secureTextEntry autoComplete="current-password" />
          <Mensagem texto={erro} />
          <Botao texto="Continuar" onPress={() => void iniciarCadastro()} carregando={enviando} />
        </>
      ) : (
        <>
          {uri ? (
            <>
              <SemCaptura />
              <Text>No app autenticador, adicione uma conta digitando esta chave:</Text>
              <Text style={estilos.mono}>{segredoDaUri(uri)}</Text>
              {Platform.OS !== 'web' ? <Botao secundario texto="Abrir no autenticador" onPress={() => void Linking.openURL(uri)} /> : null}
            </>
          ) : null}
          <Campo
            rotulo={usarRecuperacao ? 'Código de recuperação' : 'Código de 6 dígitos'}
            value={codigo}
            onChangeText={setCodigo}
            keyboardType={usarRecuperacao ? 'default' : 'number-pad'}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={usarRecuperacao ? 32 : 6}
            onSubmitEditing={() => void confirmar()}
          />
          <Mensagem texto={erro} />
          <Botao texto="Confirmar" onPress={() => void confirmar()} carregando={enviando} />
          {!cadastrando ? (
            <Botao secundario texto={usarRecuperacao ? 'Usar o autenticador' : 'Usar código de recuperação'} onPress={() => setUsarRecuperacao(!usarRecuperacao)} />
          ) : null}
        </>
      )}
      <Botao secundario texto="Sair" onPress={sairComAviso} />
    </Tela>
  );
}

const estilos = StyleSheet.create({
  codigos: { gap: 6, padding: 12, borderWidth: 1, borderColor: '#94A3B8', borderRadius: 8 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 16, letterSpacing: 1 },
});
