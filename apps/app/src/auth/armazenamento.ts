import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Token da sessão só no SecureStore (Keychain/Keystore). No web não há o que guardar: o cookie é
// HttpOnly. Nunca em armazenamento local sem cifra (apps/app/AGENTS.md).
const CHAVE = 'vv.sessao';

export async function lerToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  return SecureStore.getItemAsync(CHAVE);
}

export async function gravarToken(token: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(CHAVE, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export async function apagarToken(): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(CHAVE);
}
