import { StyleSheet, Text, View } from 'react-native';
import type { Ambiente } from '../config';

// Faixa fixa fora de produção (Prompt Mestre 0.2, ADR-015): ninguém confunde teste com dado real.
const FAIXAS: Record<Exclude<Ambiente, 'prod'>, { texto: string; cor: string }> = {
  dev: { texto: 'DESENVOLVIMENTO', cor: '#C2410C' },
  homolog: { texto: 'HOMOLOGAÇÃO', cor: '#6D28D9' },
};

export function FaixaAmbiente({ ambiente }: { ambiente: Ambiente }) {
  if (ambiente === 'prod') return null;
  const { texto, cor } = FAIXAS[ambiente];
  return (
    <View accessibilityRole="alert" style={[styles.faixa, { backgroundColor: cor }]}>
      <Text style={styles.texto}>{texto}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  faixa: { paddingVertical: 4, alignItems: 'center' },
  texto: { color: '#FFFFFF', fontWeight: '700', fontSize: 12, letterSpacing: 1 },
});
