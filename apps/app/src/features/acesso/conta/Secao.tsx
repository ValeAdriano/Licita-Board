import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <View style={estilos.secao}>
      <Text accessibilityRole="header" style={estilos.titulo}>
        {titulo}
      </Text>
      {children}
    </View>
  );
}

const estilos = StyleSheet.create({
  secao: { gap: 12, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 16 },
  titulo: { fontSize: 18, fontWeight: '700' },
});
