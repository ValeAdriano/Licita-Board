import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Expo Router publica todo arquivo de src/app/. Tela que não está num Stack.Protected do layout raiz
// fica aberta sem sessão (a API ainda confere, mas a tela não deve existir).
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n: string) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });
}

describe('rotas do app', () => {
  const raiz = join(__dirname, 'app');
  const layout = readFileSync(join(raiz, '_layout.tsx'), 'utf8');
  const protegidas = [...layout.matchAll(/<Stack\.Protected[\s\S]*?<\/Stack\.Protected>/g)]
    .flatMap((m) => [...m[0].matchAll(/<Stack\.Screen name="([^"]+)"/g)].map((n) => n[1]));
  const rotas = arquivos(raiz)
    .map((p) => relative(raiz, p).split('\\').join('/'))
    .filter((r) => r !== '_layout.tsx')
    .map((r) => r.replace(/\.tsx?$/, ''));

  it('toda tela está num Stack.Protected do layout raiz', () => {
    expect(rotas.filter((r) => !protegidas.includes(r))).toEqual([]);
  });

  it('não há layout aninhado (o guard usa o nome completo da tela)', () => {
    expect(rotas.filter((r) => r.endsWith('_layout'))).toEqual([]);
  });

  it('o teste enxerga as telas de acesso', () => {
    expect(protegidas).toEqual(expect.arrayContaining(['(app)/index', 'mfa', '(publico)/entrar']));
  });
});
