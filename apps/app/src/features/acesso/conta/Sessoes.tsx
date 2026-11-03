import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { chamar } from '../../../api/cliente';
import { Botao, Mensagem } from '../../../ui/formulario';
import { Secao } from './Secao';
import { useEnvio } from './useEnvio';

interface SessaoAberta {
  id: string;
  plataforma: string;
  user_agent: string | null;
  ip: string | null;
  ultimo_uso_em: string;
  atual: boolean;
}

const listar = () => chamar<SessaoAberta[]>('GET', '/auth/sessoes');

// Sessões abertas da própria conta (as de outras pessoas a API nem lista).
export function Sessoes() {
  const [sessoes, setSessoes] = useState<SessaoAberta[]>([]);
  const { enviando, erro, ok, enviar } = useEnvio();

  const carregar = useCallback(() => listar().then(setSessoes), []);

  // Recarrega ao voltar para a tela (troca de senha ou de autenticador encerra outras sessões).
  useFocusEffect(
    useCallback(() => {
      void listar().then(setSessoes).catch(() => {});
    }, []),
  );

  const encerrar = (id: string) =>
    enviar(async () => {
      await chamar('DELETE', `/auth/sessoes/${id}`);
      await carregar();
      return 'Sessão encerrada.';
    });

  const encerrarOutras = () =>
    enviar(async () => {
      const r = await chamar<{ encerradas: number }>('POST', '/auth/logout-todas', { manterAtual: true });
      await carregar();
      return `${r.encerradas} sessão(ões) encerrada(s).`;
    });

  return (
    <Secao titulo="Sessões abertas">
      {sessoes.map((s) => (
        <View key={s.id} style={estilos.item}>
          <Text style={estilos.titulo}>
            {s.plataforma}
            {s.atual ? ' · esta sessão' : ''}
          </Text>
          <Text style={estilos.detalhe} numberOfLines={1}>
            {[s.ip, s.user_agent].filter(Boolean).join(' · ')}
          </Text>
          <Text style={estilos.detalhe}>Último uso: {new Date(s.ultimo_uso_em).toLocaleString('pt-BR')}</Text>
          {!s.atual ? <Botao secundario texto="Encerrar" onPress={() => void encerrar(s.id)} /> : null}
        </View>
      ))}
      <Mensagem texto={erro} />
      <Mensagem tipo="info" texto={ok} />
      {sessoes.length > 1 ? <Botao texto="Encerrar as outras sessões" onPress={() => void encerrarOutras()} carregando={enviando} /> : null}
    </Secao>
  );
}

const estilos = StyleSheet.create({
  item: { gap: 2, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  titulo: { fontWeight: '600' },
  detalhe: { fontSize: 12, color: '#475569' },
});
