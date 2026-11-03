import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAcesso } from './contexto';

// Seletor de empresa do cabeçalho: só as empresas com vínculo ativo (o que /me devolve).
export function SeletorEmpresa() {
  const { vinculos, empresa, escolherEmpresa } = useAcesso();
  const [aberto, setAberto] = useState(false);
  if (vinculos.length === 0) return null;
  const rotulo = `Empresa: ${empresa?.empresa ?? ''}`;
  return (
    <>
      <Pressable role="button" aria-label={`${rotulo}. Trocar empresa`} onPress={() => setAberto(true)} style={estilos.botao}>
        <Text numberOfLines={1} style={estilos.texto}>
          {empresa?.empresa} ▾
        </Text>
      </Pressable>
      <Modal transparent visible={aberto} animationType="fade" onRequestClose={() => setAberto(false)}>
        <Pressable style={estilos.fundo} onPress={() => setAberto(false)} aria-label="Fechar">
          <View style={estilos.lista} role="list">
            <Text style={estilos.titulo}>Empresa</Text>
            {vinculos.map((v) => (
              <Pressable
                key={v.empresaId}
                role="button"
                aria-label={v.empresa}
                aria-selected={v.empresaId === empresa?.empresaId}
                onPress={() => {
                  escolherEmpresa(v.empresaId);
                  setAberto(false);
                }}
                style={[estilos.item, v.empresaId === empresa?.empresaId && estilos.atual]}
              >
                <Text style={estilos.nome}>{v.empresa}</Text>
                <Text style={estilos.papel}>{v.papel}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const estilos = StyleSheet.create({
  botao: { paddingHorizontal: 12, paddingVertical: 8, maxWidth: 220, minHeight: 44, justifyContent: 'center' },
  texto: { color: '#1D4ED8', fontWeight: '600' },
  fundo: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'center', padding: 16 },
  lista: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 8, maxWidth: 400, width: '100%', alignSelf: 'center' },
  titulo: { fontSize: 18, fontWeight: '700', padding: 12 },
  item: { padding: 12, borderRadius: 8, minHeight: 48 },
  atual: { backgroundColor: '#DBEAFE' },
  nome: { fontSize: 16, fontWeight: '600' },
  papel: { fontSize: 12, color: '#475569' },
});
