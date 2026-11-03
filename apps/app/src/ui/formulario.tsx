import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

// Peças mínimas de formulário das telas de acesso (360 px primeiro; largura máxima no web largo).
export function Tela({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <View style={estilos.tela}>
      <View style={estilos.caixa}>
        <Text accessibilityRole="header" style={estilos.titulo}>
          {titulo}
        </Text>
        {children}
      </View>
    </View>
  );
}

export function Campo({ rotulo, ...props }: TextInputProps & { rotulo: string }) {
  return (
    <View style={estilos.campo}>
      <Text style={estilos.rotulo}>{rotulo}</Text>
      <TextInput accessibilityLabel={rotulo} autoCapitalize="none" autoCorrect={false} style={estilos.input} {...props} />
    </View>
  );
}

export function Botao(props: { texto: string; onPress: () => void; carregando?: boolean; secundario?: boolean }) {
  const { texto, onPress, carregando, secundario } = props;
  return (
    <Pressable
      role="button"
      aria-label={texto}
      aria-busy={carregando}
      aria-disabled={carregando}
      disabled={carregando}
      onPress={onPress}
      style={[estilos.botao, secundario && estilos.secundario]}
    >
      {carregando ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={[estilos.textoBotao, secundario && estilos.textoSecundario]}>{texto}</Text>
      )}
    </Pressable>
  );
}

export function Mensagem({ texto, tipo = 'erro' }: { texto: string | null; tipo?: 'erro' | 'info' }) {
  if (!texto) return null;
  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={tipo === 'erro' ? estilos.erro : estilos.info}>
      {texto}
    </Text>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, justifyContent: 'center', padding: 16 },
  caixa: { width: '100%', maxWidth: 400, alignSelf: 'center', gap: 16 },
  titulo: { fontSize: 24, fontWeight: '700' },
  campo: { gap: 4 },
  rotulo: { fontSize: 14, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#94A3B8', borderRadius: 8, padding: 12, fontSize: 16, minHeight: 48 },
  botao: { backgroundColor: '#1D4ED8', borderRadius: 8, minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12 },
  secundario: { backgroundColor: 'transparent' },
  textoBotao: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  textoSecundario: { color: '#1D4ED8' },
  erro: { color: '#B91C1C', fontSize: 14 },
  info: { color: '#166534', fontSize: 14 },
});
