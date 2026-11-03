import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { chamar, ErroApi } from '../../../api/cliente';
import { segredoDaUri } from '../../../auth/links';
import { useSessao } from '../../../auth/sessao';
import { Botao, Campo, Mensagem } from '../../../ui/formulario';
import { SemCaptura } from '../../../ui/SemCaptura';
import { useAcesso, type Usuario } from '../contexto';
import { Secao } from './Secao';
import { useEnvio } from './useEnvio';

type Acao = 'codigos' | 'trocar';
type Passo =
  | { tipo: 'inicio' }
  | { tipo: 'verificar'; acao: Acao } // código de agora: a API exige MFA dos últimos 5 min
  | { tipo: 'senha' }
  | { tipo: 'novo'; segredo: string }
  | { tipo: 'reverificar'; segredo: string } // passou de 5 min: código do autenticador ATUAL
  | { tipo: 'codigos'; codigos: string[] };

const INICIO: Passo = { tipo: 'inicio' };
const DICA_CODIGO = 'Use um código novo (não o do login). Cada código errado conta; 5 encerram a sessão.';
const DICA_CODIGOS = 'Se os códigos não apareceram, gere de novo: os anteriores podem ter deixado de valer.';
const MFA_ANTIGO = (e: unknown) => e instanceof ErroApi && e.status === 403;

// Autenticador e códigos de recuperação (spec fase-01 decisão 7). Quem não tem autenticador ativa
// direto pela senha; trocar e gerar códigos pedem um código do atual. A chave e os códigos somem ao
// sair da tela ou ir para o segundo plano, e o nativo bloqueia captura enquanto aparecem.
export function Autenticador({ usuario }: { usuario: Usuario }) {
  const { elevar } = useSessao();
  const { recarregar } = useAcesso();
  const [passo, setPasso] = useState<Passo>(INICIO);
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const { enviando, erro, ok, enviar, setErro } = useEnvio();
  const temMfa = usuario.temMfa;

  useFocusEffect(useCallback(() => () => setPasso(INICIO), []));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado !== 'active') setPasso(INICIO);
    });
    return () => sub.remove();
  }, []);

  const gerarCodigos = async () => {
    try {
      const r = await chamar<{ codigos: string[] }>('POST', '/auth/mfa/codigos');
      setPasso({ tipo: 'codigos', codigos: r.codigos });
    } catch (e) {
      throw new ErroApi(e instanceof ErroApi ? e.status : 0, `${e instanceof Error ? e.message : ''} ${DICA_CODIGOS}`.trim());
    }
  };

  const verificar = (acao: Acao) =>
    enviar(async () => {
      await elevar('verificar', codigo.trim());
      setCodigo('');
      if (acao === 'codigos') await gerarCodigos();
      else setPasso({ tipo: 'senha' });
    });

  const cadastrar = () =>
    enviar(async () => {
      try {
        const r = await chamar<{ uri: string }>('POST', '/auth/mfa/cadastrar', { senha });
        setSenha('');
        setPasso({ tipo: 'novo', segredo: segredoDaUri(r.uri) });
      } catch (e) {
        if (temMfa && MFA_ANTIGO(e)) setPasso({ tipo: 'verificar', acao: 'trocar' });
        throw e;
      }
    });

  const confirmar = (segredo: string) =>
    enviar(async () => {
      try {
        await elevar('confirmar', codigo.trim());
      } catch (e) {
        if (temMfa && MFA_ANTIGO(e)) {
          setCodigo('');
          setPasso({ tipo: 'reverificar', segredo });
          return;
        }
        throw e;
      }
      // Confirmado: sai do passo na hora (repetir "confirmar" sem pendente contaria como erro).
      setCodigo('');
      setPasso(INICIO);
      await recarregar().catch(() => {});
      if (!temMfa) return gerarCodigos(); // primeiro autenticador: códigos logo em seguida
      return 'Autenticador trocado. O anterior deixou de valer.';
    });

  const reverificar = (segredo: string) =>
    enviar(async () => {
      await elevar('verificar', codigo.trim());
      setCodigo('');
      setPasso({ tipo: 'novo', segredo });
    });

  const campoCodigo = (onSubmit: () => void, rotulo = 'Código de 6 dígitos') => (
    <Campo
      rotulo={rotulo}
      value={codigo}
      onChangeText={setCodigo}
      keyboardType="number-pad"
      autoComplete="one-time-code"
      textContentType="oneTimeCode"
      maxLength={6}
      onSubmitEditing={onSubmit}
    />
  );

  const cancelar = () => {
    setErro(null);
    setCodigo('');
    setSenha('');
    setPasso(INICIO);
  };

  return (
    <Secao titulo="Verificação em duas etapas">
      {passo.tipo === 'inicio' ? (
        temMfa ? (
          <>
            <Text>Autenticador ativo.</Text>
            <Botao texto="Gerar novos códigos de recuperação" onPress={() => setPasso({ tipo: 'verificar', acao: 'codigos' })} />
            <Botao secundario texto="Trocar autenticador" onPress={() => setPasso({ tipo: 'verificar', acao: 'trocar' })} />
          </>
        ) : (
          <>
            <Text>Proteja sua conta com um app autenticador.</Text>
            <Botao texto="Ativar autenticador" onPress={() => setPasso({ tipo: 'senha' })} />
          </>
        )
      ) : null}
      {passo.tipo === 'verificar' ? (
        <>
          <Text>Digite o código do autenticador atual. {DICA_CODIGO}</Text>
          {campoCodigo(() => void verificar(passo.acao))}
          <Botao texto="Continuar" onPress={() => void verificar(passo.acao)} carregando={enviando} />
        </>
      ) : null}
      {passo.tipo === 'senha' ? (
        <>
          <Text>Confirme sua senha para cadastrar o novo autenticador. Conclua em até 5 minutos.</Text>
          <Campo rotulo="Senha" value={senha} onChangeText={setSenha} secureTextEntry autoComplete="current-password" />
          <Botao texto="Continuar" onPress={() => void cadastrar()} carregando={enviando} />
        </>
      ) : null}
      {passo.tipo === 'novo' ? (
        <>
          <SemCaptura />
          <Text>No app autenticador, adicione uma conta digitando esta chave e confirme com o código gerado:</Text>
          <Text style={estilos.mono}>{passo.segredo}</Text>
          {campoCodigo(() => void confirmar(passo.segredo), 'Código do novo autenticador')}
          <Botao texto="Confirmar" onPress={() => void confirmar(passo.segredo)} carregando={enviando} />
        </>
      ) : null}
      {passo.tipo === 'reverificar' ? (
        <>
          <Text>Passaram mais de 5 minutos. Digite um código do autenticador ATUAL para continuar o cadastro.</Text>
          {campoCodigo(() => void reverificar(passo.segredo), 'Código do autenticador atual')}
          <Botao texto="Continuar" onPress={() => void reverificar(passo.segredo)} carregando={enviando} />
        </>
      ) : null}
      {passo.tipo === 'codigos' ? (
        <>
          <SemCaptura />
          <Text>Guarde em lugar seguro antes de sair desta tela. Eles não serão mostrados de novo; se havia códigos anteriores, eles deixaram de valer.</Text>
          <View style={estilos.codigos}>
            {passo.codigos.map((c) => (
              <Text key={c} selectable style={estilos.mono}>
                {c.match(/.{1,5}/g)?.join('-')}
              </Text>
            ))}
          </View>
          <Botao texto="Guardei os códigos" onPress={() => setPasso(INICIO)} />
        </>
      ) : null}
      <Mensagem texto={erro} />
      <Mensagem tipo="info" texto={ok} />
      {passo.tipo !== 'inicio' && passo.tipo !== 'codigos' ? <Botao secundario texto="Cancelar" onPress={cancelar} /> : null}
    </Secao>
  );
}

const estilos = StyleSheet.create({
  codigos: { gap: 6, padding: 12, borderWidth: 1, borderColor: '#94A3B8', borderRadius: 8 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 16, letterSpacing: 1 },
});
