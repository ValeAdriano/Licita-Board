import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { modulosDe, useAcesso } from '../../features/acesso/contexto';
import { ConvitesRecebidos } from '../../features/acesso/equipe/ConvitesRecebidos';

// Início: a empresa selecionada e os módulos que o vínculo libera. Os módulos chegam nas próximas
// fases; até lá aparecem como EM DESENVOLVIMENTO (regra 8 do AGENTS.md).
export default function Inicio() {
  const { usuario, empresa } = useAcesso();
  return (
    <ScrollView contentContainerStyle={estilos.tela}>
      <Text accessibilityRole="header" style={estilos.titulo}>
        {usuario ? `Olá, ${usuario.nome}` : 'VV Licitações'}
      </Text>
      <ConvitesRecebidos />
      {empresa ? (
        <>
          <Text style={estilos.sub}>
            {empresa.empresa} · {empresa.papel}
          </Text>
          {modulosDe(empresa.permissoes).map((m) => (
            <View key={m} style={estilos.cartao}>
              <Text style={estilos.modulo}>{m}</Text>
              <Text style={estilos.aviso}>EM DESENVOLVIMENTO</Text>
            </View>
          ))}
          {empresa.permissoes.length === 0 ? <Text>Seu acesso a esta empresa ainda não tem permissões.</Text> : null}
        </>
      ) : (
        <Text>Você ainda não tem acesso a nenhuma empresa. Quando um administrador te convidar, o convite aparece aqui.</Text>
      )}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  tela: { padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  titulo: { fontSize: 24, fontWeight: '700' },
  sub: { fontSize: 16, color: '#475569' },
  cartao: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 12, flexDirection: 'row', justifyContent: 'space-between' },
  modulo: { fontSize: 16, fontWeight: '600', textTransform: 'capitalize' },
  aviso: { fontSize: 12, fontWeight: '600', color: '#92400E' },
});
