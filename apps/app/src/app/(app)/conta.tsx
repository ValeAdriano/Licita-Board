import { ScrollView, StyleSheet } from 'react-native';
import { mensagemSair, useSessao } from '../../auth/sessao';
import { useAcesso } from '../../features/acesso/contexto';
import { Autenticador } from '../../features/acesso/conta/Autenticador';
import { Perfil } from '../../features/acesso/conta/Perfil';
import { Senha } from '../../features/acesso/conta/Senha';
import { Sessoes } from '../../features/acesso/conta/Sessoes';
import { useEnvio } from '../../features/acesso/conta/useEnvio';
import { Botao, Mensagem } from '../../ui/formulario';

export default function Conta() {
  const { usuario } = useAcesso();
  const { sair } = useSessao();
  const { erro, setErro } = useEnvio();
  return (
    <ScrollView contentContainerStyle={estilos.tela}>
      {usuario ? (
        <>
          <Perfil key={usuario.id} usuario={usuario} />
          <Senha temMfa={usuario.temMfa} />
          <Autenticador usuario={usuario} />
        </>
      ) : null}
      <Sessoes />
      <Mensagem texto={erro} />
      <Botao secundario texto="Sair" onPress={() => void sair().catch((e: unknown) => setErro(mensagemSair(e)))} />
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  tela: { padding: 16, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' },
});
