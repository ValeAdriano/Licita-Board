import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AMBIENTE } from '../config';
import { FaixaAmbiente } from '../ui/FaixaAmbiente';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <FaixaAmbiente ambiente={AMBIENTE} />
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaView>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
