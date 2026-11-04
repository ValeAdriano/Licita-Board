import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Fumaça da Fase 02 (representantes, procurações, catálogo, produtos, fichas, palavras-chave) e os
// critérios de aceite principais: atributo novo sem migration e produto em duas empresas sem vazar custo.
describe('fase 02', () => {
  let app: INestApplication;
  const http = () => request.agent(servidor(app)).set('X-Forwarded-For', ipNovo());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  interface Conta { email: string; token: string; uri: string }
  async function entrar(email: string): Promise<Conta> {
    const login = await http().post('/auth/login').send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
    const t0 = (login.body as { token: string }).token;
    const cad = await http().post('/auth/mfa/cadastrar').set(bearer(t0)).send({ senha: SENHA }).expect(200);
    const uri = (cad.body as { uri: string }).uri;
    const conf = await http().post('/auth/mfa/confirmar').set(bearer(t0)).send({ codigo: totpDaUri(uri) }).expect(200);
    await admin.query(`update core.fatores_mfa set verificado_em = now() - interval '2 days' where usuario_id = (select id from core.usuarios where email = $1)`, [email]);
    return { email, uri, token: (conf.body as { token: string }).token };
  }
  async function stepUp(c: Conta, escopo: string): Promise<string> {
    await admin.query(`update core.fatores_mfa set ultimo_passo = 0 where usuario_id = (select id from core.usuarios where email = $1)`, [c.email]);
    const r = await http().post('/auth/mfa/step-up').set(bearer(c.token)).send({ codigo: totpDaUri(c.uri), escopo }).expect(200);
    const b = r.body as { stepUp: string; token: string };
    c.token = b.token;
    return b.stepUp;
  }

  let empA: string; let empB: string; let a: Conta; let b: Conta; let sup: Conta;
  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Empresa fase2 A');
    empB = await criarEmpresa('Empresa fase2 B');
    const emailA = await criarUsuario('f2-a'); const emailB = await criarUsuario('f2-b'); const emailS = await criarUsuario('f2-s');
    await vincular(emailA, empA); await vincular(emailB, empB);
    await admin.query('update core.usuarios set superadmin = true where email = $1', [emailS]);
    a = await entrar(emailA); b = await entrar(emailB); sup = await entrar(emailS);
  });
  afterAll(async () => {
    await app.close();
  });

  it('representante: CPF validado e cifrado, só máscara na lista, revelar com step-up; poderes, procuração e signatário', async () => {
    const t = () => bearer(a.token);
    await http().post(`/empresas/${empA}/representantes`).set(t()).send({ tipo: 'PROCURADOR', nome: 'Caio', cpf: '529.982.247-26' }).expect(400);
    const r = await http().post(`/empresas/${empA}/representantes`).set(t()).send({ tipo: 'PROCURADOR', nome: 'Caio Procurador', cpf: '529.982.247-25', email: 'caio@a.test' }).expect(201);
    const id = (r.body as { id: string }).id;
    await http().post(`/empresas/${empA}/representantes`).set(t()).send({ tipo: 'ADVOGADO', nome: 'Sem OAB', cpf: '111.444.777-35' }).expect(400);
    await http().post(`/empresas/${empA}/representantes`).set(t()).send({ tipo: 'PROCURADOR', nome: 'CPF repetido', cpf: '52998224725' }).expect(409);
    const lista = (await http().get(`/empresas/${empA}/representantes`).set(t()).expect(200)).body as { cpfMascara: string }[];
    expect(JSON.stringify(lista)).not.toContain('52998224725');
    expect(lista[0]?.cpfMascara).toContain('•');
    const su = await stepUp(a, 'dados_pessoais');
    const rev = await http().post(`/empresas/${empA}/representantes/${id}/revelar-cpf`).set(t()).send({ stepUp: su }).expect(200);
    expect(rev.body).toEqual({ valor: '52998224725' });

    await http().put(`/empresas/${empA}/representantes/${id}/poderes`).set(t()).send({ poderes: ['assinar_proposta'] }).expect(204);
    const proc = await http().post(`/empresas/${empA}/representantes/${id}/procuracoes`).set(t())
      .send({ numero: '123', dataEmissao: '2026-01-10', dataValidade: '2026-06-30', poderes: ['assinar_proposta'] }).expect(201);
    const consulta = (data: string, poder: string) => http().get(`/empresas/${empA}/representantes/${id}/signatario-valido?data=${data}&poder=${poder}`).set(t()).expect(200);
    expect((await consulta('2026-06-30', 'assinar_proposta')).body).toEqual({ valido: true });
    expect((await consulta('2026-07-01', 'assinar_proposta')).body).toEqual({ valido: false });
    expect((await consulta('2026-03-01', 'firmar_contrato')).body).toEqual({ valido: false });
    await http().post(`/empresas/${empA}/procuracoes/${(proc.body as { id: string }).id}/revogar`).set(t()).send({ data: '2026-04-01' }).expect(204);
    expect((await consulta('2026-04-01', 'assinar_proposta')).body).toEqual({ valido: false });
    await http().get(`/empresas/${empB}/representantes`).set(bearer(a.token)).expect(404);
  });

  it('catálogo: SUPERADMIN cria atributo e modelo sem migration; os demais só leem; conversão exata', async () => {
    const cats = (await http().get('/catalogo/categorias').set(bearer(a.token)).expect(200)).body as { id: string; slug: string }[];
    const veiculos = cats.find((c) => c.slug === 'veiculos')?.id ?? '';
    await http().post('/catalogo/atributos').set(bearer(a.token)).send({ categoriaId: veiculos, slug: 'cor_invasora', nome: 'Cor', tipo: 'texto' }).expect(403);
    const novo = await http().post('/catalogo/atributos').set(bearer(sup.token)).send({ categoriaId: veiculos, slug: 'cor_e2e', nome: 'Cor', tipo: 'texto' }).expect(201);
    expect((novo.body as { id: string }).id).toBeTruthy();
    const conv = await http().get('/catalogo/converter?valor=100&de=cv&para=kW').set(bearer(a.token)).expect(200);
    expect(Number((conv.body as { valor: string }).valor)).toBeCloseTo(73.549875, 6);
    await http().get('/catalogo/converter?valor=1&de=kW&para=kg').set(bearer(a.token)).expect(400);
  });

  it('produto em duas empresas: modelo compartilhado, custo e produto de A invisíveis para B; atributo novo gravado', async () => {
    const cats = (await http().get('/catalogo/categorias').set(bearer(sup.token))).body as { id: string; slug: string }[];
    const veiculos = cats.find((c) => c.slug === 'veiculos')?.id ?? '';
    const modelo = await http().post('/catalogo/modelos').set(bearer(sup.token)).send({ categoriaId: veiculos, fabricante: 'Fab E2E', modelo: 'Modelo X', anoModelo: 2026 }).expect(201);
    const modeloId = (modelo.body as { id: string }).id;
    const atrs = (await http().get(`/catalogo/atributos?categoria=${veiculos}`).set(bearer(a.token)).expect(200)).body as { id: string; slug: string; unidadePadraoId: string | null }[];
    const pot = atrs.find((x) => x.slug === 'potencia');
    const cor = atrs.find((x) => x.slug === 'cor_e2e');
    expect(cor).toBeTruthy();
    await http().put(`/catalogo/modelos/${modeloId}/atributos`).set(bearer(sup.token)).send({ atributos: [{ atributoId: pot?.id, valorNumero: '110', unidadeId: pot?.unidadePadraoId }] }).expect(204);

    const mk = async (c: Conta, emp: string, codigo: string) => (await http().post(`/empresas/${emp}/produtos`).set(bearer(c.token))
      .send({ modeloId, categoriaId: veiculos, codigoInterno: codigo, descricao: 'Veículo do catálogo', fornecedor: 'Forn' }).expect(201)).body as { id: string };
    const pa = await mk(a, empA, 'VEI-1');
    const pb = await mk(b, empB, 'VEI-1');
    await http().post(`/empresas/${empA}/produtos`).set(bearer(a.token)).send({ modeloId, categoriaId: veiculos, codigoInterno: 'VEI-1', descricao: 'dup' }).expect(409);
    await http().put(`/empresas/${empA}/produtos/${pa.id}/atributos`).set(bearer(a.token)).send({ atributos: [{ atributoId: cor?.id, valorTexto: 'Branca' }] }).expect(204);
    await http().put(`/empresas/${empA}/produtos/${pa.id}/atributos`).set(bearer(a.token)).send({ atributos: [{ atributoId: pot?.id, valorNumero: '110', unidadeId: null }] }).expect(400);
    await http().put(`/empresas/${empA}/produtos/${pa.id}/precos`).set(bearer(a.token)).send({ precoCusto: '85000.5000', precoReferencia: '99900.0000' }).expect(204);
    await http().put(`/empresas/${empB}/produtos/${pb.id}/precos`).set(bearer(b.token)).send({ precoCusto: '70000', precoReferencia: '80000' }).expect(204);

    expect((await http().get(`/empresas/${empA}/produtos/${pa.id}/precos`).set(bearer(a.token)).expect(200)).body).toEqual({ precoCusto: '85000.5000', precoReferencia: '99900.0000' });
    expect((await http().get(`/empresas/${empB}/produtos/${pb.id}/precos`).set(bearer(b.token)).expect(200)).body).toEqual({ precoCusto: '70000.0000', precoReferencia: '80000.0000' });
    await http().get(`/empresas/${empA}/produtos/${pb.id}`).set(bearer(a.token)).expect(404);
    await http().get(`/empresas/${empA}/produtos/${pb.id}/precos`).set(bearer(a.token)).expect(200).then((r) => expect(r.body).toEqual({ precoCusto: null, precoReferencia: null }));
    await http().get(`/empresas/${empB}/produtos`).set(bearer(a.token)).expect(404);
    const listaB = (await http().get(`/empresas/${empB}/produtos`).set(bearer(b.token)).expect(200)).body as { id: string }[];
    expect(listaB.map((p) => p.id)).toEqual([pb.id]);
    const ids = new Set((await http().get(`/empresas/${empA}/produtos`).set(bearer(a.token))).body.map((p: { id: string }) => p.id));
    expect(ids.has(pb.id)).toBe(false);

    // Fichas: nova versão preserva a anterior (histórico).
    const f1 = await http().post(`/empresas/${empA}/produtos/${pa.id}/fichas`).set(bearer(a.token)).send({ fabricante: 'Fab E2E', modelo: 'Modelo X', ano: 2026, validaAte: '2099-12-31' }).expect(201);
    await http().post(`/empresas/${empA}/produtos/${pa.id}/fichas`).set(bearer(a.token)).send({ fabricante: 'Fab E2E', modelo: 'Modelo X', ano: 2027 }).expect(201);
    const fichas = (await http().get(`/empresas/${empA}/produtos/${pa.id}/fichas`).set(bearer(a.token))).body as { versaoFicha: number; situacao: string; ano: number }[];
    expect(fichas.map((f) => `${f.versaoFicha}:${f.situacao}:${f.ano}`)).toEqual(['2:vigente:2027', '1:substituida:2026']);
    await http().patch(`/empresas/${empA}/fichas/${(f1.body as { id: string }).id}`).set(bearer(a.token)).send({ situacao: 'descontinuada' }).expect(404);
  });

  it('palavras-chave: normaliza o termo (sem acento, caixa), recusa repetido, filtros por UF e faixa de valor', async () => {
    const t = () => bearer(a.token);
    await http().post(`/empresas/${empA}/palavras-chave`).set(t()).send({ tipo: 'palavra', termo: 'Ambulância' }).expect(201);
    await http().post(`/empresas/${empA}/palavras-chave`).set(t()).send({ tipo: 'palavra', termo: '  ambulancia ' }).expect(409);
    await http().post(`/empresas/${empA}/palavras-chave`).set(t()).send({ tipo: 'exclusao', termo: 'usada' }).expect(201);
    await http().post(`/empresas/${empA}/palavras-chave-filtros`).set(t()).send({ tipo: 'uf', uf: 'SP' }).expect(201);
    await http().post(`/empresas/${empA}/palavras-chave-filtros`).set(t()).send({ tipo: 'faixa_valor', valorMin: '1000', valorMax: '500' }).expect(400);
    await http().post(`/empresas/${empA}/palavras-chave-filtros`).set(t()).send({ tipo: 'faixa_valor', valorMin: '1000.50', valorMax: '5000' }).expect(201);
    const r = (await http().get(`/empresas/${empA}/palavras-chave`).set(t()).expect(200)).body as { termos: { termo: string }[]; filtros: unknown[] };
    expect(r.termos.map((x) => x.termo).sort()).toEqual(['Ambulância', 'usada']);
    expect(r.filtros).toHaveLength(2);
    expect((await http().get(`/empresas/${empB}/palavras-chave`).set(bearer(b.token)).expect(200)).body).toEqual({ termos: [], filtros: [] });
    await http().get(`/empresas/${empB}/palavras-chave`).set(t()).expect(404);
  });
});
