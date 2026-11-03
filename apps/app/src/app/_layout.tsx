import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SessaoProvider, useSessao } from '../auth/sessao';
import { AMBIENTE } from '../config';
import { FaixaAmbiente } from '../ui/FaixaAmbiente';
import { Botao, Tela } from '../ui/formulario';

// Cada grupo de telas só existe na fase certa da sessão: sem sessão não há rota do app, e sessão
// aal1 de perfil interno só vê o MFA. A API confere de novo em toda requisição. Toda tela nova entra
// num Stack.Protected abaixo (o teste src/rotas.test.ts falha se ficar de fora).
function Rotas() {
  const { fase, registrarAtividade, recarregar } = useSessao();
  if (fase === 'carregando') {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel="Carregando" />
      </View>
    );
  }
  if (fase === 'sem_conexao') {
    return (
      <Tela titulo="Sem conexão">
        <Text>Não foi possível falar com o servidor. Confira a internet e tente de novo.</Text>
        <Botao texto="Tentar de novo" onPress={recarregar} />
      </Tela>
    );
  }
  return (
    <View style={{ flex: 1 }} onTouchStart={registrarAtividade}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={fase === 'ativa'}>
          <Stack.Screen name="(app)/index" />
        </Stack.Protected>
        <Stack.Protected guard={fase === 'mfa'}>
          <Stack.Screen name="mfa" />
        </Stack.Protected>
        <Stack.Protected guard={fase === 'anonimo'}>
          <Stack.Screen name="(publico)/entrar" />
          <Stack.Screen name="(publico)/recuperar" />
          <Stack.Screen name="(publico)/redefinir-senha" />
        </Stack.Protected>
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <FaixaAmbiente ambiente={AMBIENTE} />
        <SessaoProvider>
          <Rotas />
        </SessaoProvider>
      </SafeAreaView>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
