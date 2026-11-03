import { useEffect, useRef } from 'react';
import { Text } from 'react-native';
import { TURNSTILE_SITEKEY } from '../config';

// Turnstile (spec fase-01 decisão 4): só aparece depois que a API pediu CAPTCHA.
type Opcoes = { sitekey: string; callback: (t: string) => void; 'expired-callback': () => void; 'error-callback': () => void };
type Turnstile = { render(el: HTMLElement, o: Opcoes): string; reset(id: string): void; remove(id: string): void };
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function carregar(): Promise<Turnstile> {
  const w = window as unknown as { turnstile?: Turnstile };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (w.turnstile ? ok(w.turnstile) : falha(new Error('turnstile')));
    s.onerror = () => falha(new Error('turnstile'));
    document.head.appendChild(s);
  });
}

export function Captcha({ aoResolver }: { aoResolver: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!TURNSTILE_SITEKEY) return;
    let vivo = true;
    let widget: { t: Turnstile; id: string } | null = null;
    void carregar()
      .then((t) => {
        if (!vivo || !ref.current) return;
        const id = t.render(ref.current, {
          sitekey: TURNSTILE_SITEKEY,
          callback: aoResolver,
          'expired-callback': () => t.reset(id),
          'error-callback': () => t.reset(id),
        });
        widget = { t, id };
      })
      .catch(() => {});
    return () => {
      vivo = false;
      if (widget) widget.t.remove(widget.id);
    };
  }, [aoResolver]);
  if (!TURNSTILE_SITEKEY) {
    return <Text accessibilityRole="alert">Verificação adicional indisponível no momento. Tente mais tarde.</Text>;
  }
  return <div ref={ref} />;
}
