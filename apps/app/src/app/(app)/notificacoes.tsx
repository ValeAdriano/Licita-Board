import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import { useAcesso } from '../../features/acesso/contexto';

// Notificações do próprio usuário (criadas só pelo worker). Tocar marca como lida.
export default function Notificacoes() {
  const { notificacoes, marcarLida, vinculos } = useAcesso();
  // Lista de todas as empresas: cada item diz de qual é (prazo de uma não pode parecer de outra).
  const nomeEmpresa = (id: string | null) => vinculos.find((v) => v.empresaId === id)?.empresa;
  return (
    <FlatList
      contentContainerStyle={estilos.lista}
      data={notificacoes}
      keyExtractor={(n) => n.id}
      ListEmptyComponent={<Text style={estilos.vazio}>Nenhuma notificação.</Text>}
      renderItem={({ item }) => (
        <Pressable
          role="button"
          aria-label={`${item.lidaEm ? '' : 'Não lida: '}${item.titulo}`}
          onPress={() => (item.lidaEm ? undefined : void marcarLida(item.id).catch(() => {}))}
          style={[estilos.item, !item.lidaEm && estilos.naoLida]}
        >
          {nomeEmpresa(item.empresaId) ? <Text style={estilos.empresa}>{nomeEmpresa(item.empresaId)}</Text> : null}
          <Text style={estilos.titulo}>{item.titulo}</Text>
          {item.corpo ? <Text>{item.corpo}</Text> : null}
          <Text style={estilos.data}>{new Date(item.criadaEm).toLocaleString('pt-BR')}</Text>
        </Pressable>
      )}
    />
  );
}

const estilos = StyleSheet.create({
  lista: { padding: 16, gap: 8, maxWidth: 720, width: '100%', alignSelf: 'center' },
  vazio: { color: '#475569', textAlign: 'center', padding: 24 },
  item: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 12, gap: 4 },
  naoLida: { borderColor: '#1D4ED8', backgroundColor: '#EFF6FF' },
  titulo: { fontWeight: '700' },
  empresa: { fontSize: 12, fontWeight: '600', color: '#1D4ED8' },
  data: { fontSize: 12, color: '#64748B' },
});
