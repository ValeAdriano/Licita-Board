import { usePreventScreenCapture } from 'expo-screen-capture';

// Enquanto montado, o nativo bloqueia captura e gravação de tela (chave TOTP, códigos de
// recuperação). No web não há como impedir; lá a proteção é não deixar a tela aberta.
export function SemCaptura() {
  usePreventScreenCapture();
  return null;
}
