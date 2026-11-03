import { acaoPermitida, alternar, filtrarPorPapel, iguais, resumoMudanca, sugestaoPorPapel } from './matriz';

const modulos = [
  { slug: 'empresas', nome: 'Empresas' },
  { slug: 'permissoes', nome: 'Permissões' },
  { slug: 'juridico', nome: 'Jurídico' },
  { slug: 'precos', nome: 'Preços' },
];

describe('sugestaoPorPapel', () => {
  it('ADMIN_EMPRESA recebe tudo', () => {
    expect(sugestaoPorPapel('ADMIN_EMPRESA', modulos).size).toBe(4 * 12);
  });

  it('OPERADOR não administra permissões nem vê custos', () => {
    const s = sugestaoPorPapel('OPERADOR', modulos);
    expect(s.has('permissoes:visualizar')).toBe(false);
    expect(s.has('precos:ver_custos_margens')).toBe(false);
    expect(s.has('empresas:editar')).toBe(true);
  });

  it('JURÍDICO visualiza tudo e elabora/aprova peças', () => {
    const s = sugestaoPorPapel('JURIDICO', modulos);
    expect(s.has('precos:visualizar')).toBe(true);
    expect(s.has('juridico:aprovar_peca')).toBe(true);
    expect(s.has('precos:editar')).toBe(false);
  });

  it('CLIENTE só visualiza módulos liberados', () => {
    expect([...sugestaoPorPapel('CLIENTE', modulos)]).toEqual(['empresas:visualizar']);
  });
});

describe('regras do CLIENTE', () => {
  it('só visualizar é permitido', () => {
    expect(acaoPermitida('CLIENTE', 'visualizar')).toBe(true);
    expect(acaoPermitida('CLIENTE', 'editar')).toBe(false);
    expect(acaoPermitida('OPERADOR', 'editar')).toBe(true);
  });

  it('trocar para CLIENTE remove ações de escrita', () => {
    const r = filtrarPorPapel('CLIENTE', new Set(['empresas:visualizar', 'empresas:editar']));
    expect(iguais(r, new Set(['empresas:visualizar']))).toBe(true);
  });
});

describe('alternar e iguais', () => {
  it('marca e desmarca sem alterar o conjunto original', () => {
    const base = new Set(['agenda:visualizar']);
    const com = alternar(base, 'agenda', 'editar');
    expect(com.has('agenda:editar')).toBe(true);
    expect(base.has('agenda:editar')).toBe(false);
    expect(iguais(alternar(com, 'agenda', 'editar'), base)).toBe(true);
  });
});

describe('resumoMudanca', () => {
  it('conta o que foi acrescentado e removido', () => {
    expect(resumoMudanca(new Set(['a:x', 'b:y']), new Set(['a:x', 'c:z', 'd:w']))).toEqual(['Permissões: +2 · −1 (total 3)']);
  });
});
