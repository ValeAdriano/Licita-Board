import { Platform } from 'react-native';
import { tokenDoFragmento } from './links';

// Roda uma vez, no carregamento do bundle web (index.ts), antes do roteador.
let guardado: string | null = null; // some ao recarregar a página

if (Platform.OS === 'web' && typeof window !== 'undefined' && /(^#|&)token=/.test(window.location.hash)) {
  guardado = tokenDoFragmento(window.location.hash);
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
}

// Sem apagar ao ler: o StrictMode de dev chama o inicializador do estado duas vezes.
export function tokenWebCapturado(): string | null {
  return guardado;
}

export function descartarTokenWeb(): void {
  guardado = null;
}
