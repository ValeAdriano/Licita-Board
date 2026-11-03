import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { consultarHealth, type StatusApi } from '../api/health';

// Tela provisória da Fase 00: prova que o app alcança a API nas três plataformas.
// O login e o shell entram na Fase 01.
export default function Inicio() {
  const [status, setStatus] = useState<StatusApi | null>(null);

  useEffect(() => {
    let ativo = true;
    void consultarHealth().then((s) => {
      if (ativo) setStatus(s);
    });
    return () => {
      ativo = false;
    };
  }, []);

  return (
    <View style={styles.tela}>
      <Text style={styles.titulo}>VV Licitações</Text>
      <Text style={styles.aviso}>EM DESENVOLVIMENTO</Text>
      {status === null ? (
        <ActivityIndicator accessibilityLabel="Consultando a API" />
      ) : status.estado === 'ok' ? (
        <Text style={styles.ok}>API conectada ({status.ambiente})</Text>
      ) : (
        <Text style={styles.erro}>API indisponível</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tela: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  titulo: { fontSize: 24, fontWeight: '700' },
  aviso: { fontSize: 12, fontWeight: '600', color: '#92400E' },
  ok: { fontSize: 16, color: '#166534' },
  erro: { fontSize: 16, color: '#B91C1C' },
});
