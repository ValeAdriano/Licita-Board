import { Text } from 'react-native';

// Nativo: o Turnstile precisa de WebView (EM DESENVOLVIMENTO). Até lá, quem cai no CAPTCHA entra
// pelo navegador (risco aceito no threat-model, T5.6).
export function Captcha(_props: { aoResolver: (token: string) => void }) {
  return (
    <Text accessibilityRole="alert" style={{ color: '#92400E' }}>
      Verificação adicional necessária. Ela ainda está EM DESENVOLVIMENTO no app: por enquanto, entre pelo navegador.
    </Text>
  );
}
