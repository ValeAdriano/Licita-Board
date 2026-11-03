import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PAPEIS, type Papel } from '../matriz';

export function SeletorPapel(props: { papel: Papel; aoMudar: (p: Papel) => void; desabilitado?: boolean }) {
  const { papel, aoMudar, desabilitado } = props;
  return (
    <View style={estilos.linha} role="radiogroup" aria-label="Papel">
      {PAPEIS.map((p) => (
        <Pressable
          key={p.id}
          role="radio"
          aria-checked={papel === p.id}
          aria-label={p.rotulo}
          disabled={desabilitado}
          onPress={() => aoMudar(p.id)}
          style={[estilos.chip, papel === p.id && estilos.marcado, desabilitado && estilos.bloqueado]}
        >
          <Text style={[estilos.texto, papel === p.id && estilos.textoMarcado]}>{p.rotulo}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const estilos = StyleSheet.create({
  linha: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: '#94A3B8', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  marcado: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  bloqueado: { opacity: 0.5 },
  texto: { fontSize: 14 },
  textoMarcado: { color: '#FFFFFF', fontWeight: '600' },
});
