import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Expo Router publica todo arquivo de src/app/. Tela que não está num Stack.Protected do layout raiz
// fica aberta sem sessão (a API ainda confere, mas a tela não deve existir). O grupo público lista as
// telas uma a uma (sem layout próprio, o redirecionamento do guard cai direto no login).
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
    .flatMap((m) => [...m[0].matchAll(/<Stack\.Screen name="([^"]+)"/g)].map((n) => n[1] ?? ''));
  const rotas = arquivos(raiz)
    .map((p) => relative(raiz, p).split('\\').join('/'))
    .filter((r) => r !== '_layout.tsx')
    .map((r) => r.replace(/\.tsx?$/, ''));

  // Grupo protegido pelo nome (ex.: "(app)") cobre as telas dele se tiver layout próprio.
  const cobertas = (r: string) =>
    protegidas.includes(r) ||
    protegidas.some((g) => g.startsWith('(') && rotas.includes(`${g}/_layout`) && r.startsWith(`${g}/`));

  it('toda tela está num Stack.Protected do layout raiz', () => {
    expect(rotas.filter((r) => !cobertas(r))).toEqual([]);
  });

  it('grupo sem layout próprio não é protegido pelo nome do grupo', () => {
    const grupos = protegidas.filter((g) => g.startsWith('(') && !g.includes('/'));
    expect(grupos.filter((g) => !rotas.includes(`${g}/_layout`))).toEqual([]);
  });

  // Com _layout próprio, o diretório vira UMA rota no layout raiz: protegê-lo pelas telas de dentro
  // ("(publico)/entrar") deixaria o grupo publicado sem guard.
  it('todo diretório com layout é protegido pelo próprio nome, nunca pelas telas de dentro', () => {
    const comLayout = rotas.filter((r) => r.endsWith('/_layout')).map((r) => r.slice(0, -'/_layout'.length));
    expect(comLayout.filter((d) => !protegidas.includes(d))).toEqual([]);
    expect(protegidas.filter((p) => comLayout.some((d) => p.startsWith(`${d}/`)))).toEqual([]);
  });

  it('o teste enxerga as telas de acesso', () => {
    expect(protegidas).toEqual(expect.arrayContaining(['(app)', 'mfa', '(publico)/entrar']));
    expect(cobertas('(app)/conta')).toBe(true);
  });
});
