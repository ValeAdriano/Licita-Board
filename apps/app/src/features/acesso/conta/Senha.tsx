import { useState } from 'react';
import { ErroApi } from '../../../api/cliente';
import { problemaNaNovaSenha } from '../../../auth/links';
import { useSessao } from '../../../auth/sessao';
import { Botao, Campo, Mensagem } from '../../../ui/formulario';
import { Secao } from './Secao';
import { useEnvio } from './useEnvio';

// Troca logada: exige a senha atual e, de quem tem autenticador, um código de agora (a API pede MFA
// dos últimos 5 min e recusa antes de contar erro). As outras sessões são encerradas pela API.
export function Senha({ temMfa }: { temMfa: boolean }) {
  const { trocarSenha, elevar } = useSessao();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [codigo, setCodigo] = useState('');
  const { enviando, erro, ok, enviar, setErro } = useEnvio();

  const salvar = () => {
    const problema = problemaNaNovaSenha(nova, confirmacao);
    if (problema) return setErro(problema);
    if (temMfa && !/^\d{6}$/.test(codigo.trim())) return setErro('Informe o código de 6 dígitos do autenticador.');
    void enviar(async () => {
      if (temMfa) await elevar('verificar', codigo.trim());
      setCodigo('');
      try {
        await trocarSenha(atual, nova);
      } catch (e) {
        if (e instanceof ErroApi && e.status === 403) throw new ErroApi(400, 'O código expirou. Use o próximo código do autenticador.');
        throw e;
      }
      setAtual('');
      setNova('');
      setConfirmacao('');
      return 'Senha trocada. As outras sessões foram encerradas.';
    });
  };

  return (
    <Secao titulo="Senha">
      <Campo rotulo="Senha atual" value={atual} onChangeText={setAtual} secureTextEntry autoComplete="current-password" />
      <Campo rotulo="Nova senha" value={nova} onChangeText={setNova} secureTextEntry autoComplete="new-password" />
      <Campo rotulo="Repita a nova senha" value={confirmacao} onChangeText={setConfirmacao} secureTextEntry autoComplete="new-password" />
      {temMfa ? (
        <Campo rotulo="Código do autenticador" value={codigo} onChangeText={setCodigo} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} />
      ) : null}
      <Mensagem texto={erro} />
      <Mensagem tipo="info" texto={ok} />
      <Botao texto="Trocar senha" onPress={salvar} carregando={enviando} />
    </Secao>
  );
}
