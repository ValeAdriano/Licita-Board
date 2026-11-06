import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Pesquisa histórica avançada da Fase 12 (12.4): texto e filtros combinados, só o módulo permitido aparece e A x B.
describe('busca avançada: filtros, permissões e A x B', () => {
  let app: INestApplication;
  const http = () => request.agent(servidor(app)).set('X-Forwarded-For', ipNovo());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  async function entrar(email: string): Promise<string> {
    const login = await http().post('/auth/login').send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
    const t0 = (login.body as { token: string }).token;
    const cad = await http().post('/auth/mfa/cadastrar').set(bearer(t0)).send({ senha: SENHA }).expect(200);
    const conf = await http().post('/auth/mfa/confirmar').set(bearer(t0)).send({ codigo: totpDaUri((cad.body as { uri: string }).uri) }).expect(200);
    await admin.query(`update core.fatores_mfa set verificado_em = now() - interval '2 days' where usuario_id = (select id from core.usuarios where email = $1)`, [email]);
    return (conf.body as { token: string }).token;
  }

  let empA: string; let empB: string; let a: string; let b: string; let limitado: string; let edital: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Busca A'); empB = await criarEmpresa('Busca B');
    const [eA, eB, eL] = await Promise.all([criarUsuario('bu-a'), criarUsuario('bu-b'), criarUsuario('bu-l')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eL, empA, 'OPERADOR', ['relatorios:visualizar', 'juridico:visualizar']); // sem editais, documentos, produtos, agenda, contratos
    [a, b, limitado] = await Promise.all([entrar(eA), entrar(eB), entrar(eL)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Prefeitura Busca', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo, data_publicacao) values ($1, $2, $3, '12/2026', 'Aquisição de ambulância tipo furgão', repeat('3', 64), '2026-03-10') returning id`, [fonte, `BU-${crypto.randomUUID()}`, orgao])).rows[0]?.id ?? '';
    const tipo = (await admin.query<{ id: string }>(`select id from pub.tipos_documento limit 1`)).rows[0]?.id;
    await admin.query(`insert into priv.documentos (empresa_id, tipo_id, descricao, numero) values ($1, $2, 'Certidão do fabricante da ambulância', 'CF-77')`, [empA, tipo]);
    const cat = (await admin.query<{ id: string }>(`select id from pub.categorias where slug = 'veiculos'`)).rows[0]?.id;
    await admin.query(`insert into priv.produtos (empresa_id, categoria_id, codigo_interno, descricao) values ($1, $2, 'AMB-1', 'Ambulância UTI móvel')`, [empA, cat]);
    const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empA, edital])).rows[0]?.id ?? '';
    await admin.query(`insert into priv.pecas (empresa_id, acompanhamento_id, tipo, titulo, minuta) values ($1, $2, 'impugnacao', 'Impugnação ao item da ambulância', 'minuta secreta sobre XYZ')`, [empA, ac]);
    await admin.query(`insert into priv.contratos (empresa_id, numero, orgao, objeto, vigencia_inicio, vigencia_fim) values ($1, 'CT-5/2026', 'Prefeitura Busca', 'Fornecimento de ambulância', '2026-01-01', '2026-12-31')`, [empA]);
  });
  afterAll(async () => {
    await app.close();
  });

  const url = (emp: string, qs: string) => `/empresas/${emp}/busca?${qs}`;
  type R = Record<string, { tipo: string; id: string; titulo: string; link: string }[] | null>;

  it('texto com acento e filtros combinados: encontra em cada módulo e respeita tipos, datas e UF', async () => {
    const r = (await http().get(url(empA, 'q=ambulancia')).set(bearer(a)).expect(200)).body as R; // sem acento: o texto do edital é unaccent
    expect(Object.keys(r).sort()).toEqual(['contrato', 'documento', 'edital', 'peca', 'produto', 'resultado']);
    expect(r.edital?.map((x) => x.link)).toContain(`/editais/${edital}`);
    expect([r.documento, r.produto, r.peca, r.contrato].map((x) => x?.length)).toEqual([1, 1, 1, 1]);
    expect(r.resultado).toEqual([]);
    const so = (await http().get(url(empA, 'q=ambul&tipos=peca,contrato')).set(bearer(a)).expect(200)).body as R;
    expect(Object.keys(so).sort()).toEqual(['contrato', 'peca']);
    const datas = (await http().get(url(empA, 'q=ambul&tipos=edital&de=2026-03-01&ate=2026-03-31&uf=PR')).set(bearer(a)).expect(200)).body as R;
    expect(datas.edital?.length).toBeGreaterThanOrEqual(1);
    expect(((await http().get(url(empA, 'q=ambul&tipos=edital&ate=2026-01-01')).set(bearer(a)).expect(200)).body as R).edital).toEqual([]);
    expect(((await http().get(url(empA, 'q=ambul&tipos=edital&uf=SC')).set(bearer(a)).expect(200)).body as R).edital).toEqual([]);
    await http().get(url(empA, 'q=a')).set(bearer(a)).expect(400); // texto curto demais
    await http().get(url(empA, 'q=ambul&uf=PARANA')).set(bearer(a)).expect(400);
    await http().get(url(empA, 'q=ambul&de=10-03-2026')).set(bearer(a)).expect(400);
  });

  it('quem só vê o jurídico recebe null nos outros módulos; a minuta não vaza no resumo', async () => {
    const r = (await http().get(url(empA, 'q=ambulancia')).set(bearer(limitado)).expect(200)).body as R;
    expect([r.edital, r.documento, r.produto, r.resultado, r.contrato]).toEqual([null, null, null, null, null]);
    expect(r.peca?.map((x) => x.titulo)).toEqual(['Impugnação ao item da ambulância']);
    expect(JSON.stringify(r)).not.toContain('secreta');
    const porMinuta = (await http().get(url(empA, 'q=secreta&tipos=peca')).set(bearer(limitado)).expect(200)).body as R;
    expect(porMinuta.peca).toHaveLength(1); // acha pelo texto da minuta, mas devolve só o título
    expect(JSON.stringify(porMinuta)).not.toContain('XYZ');
  });

  it('A x B: B não busca na empresa de A e a própria busca de B não traz dado de A', async () => {
    await http().get(url(empA, 'q=ambulancia')).set(bearer(b)).expect(404);
    const r = (await http().get(url(empB, 'q=ambulancia')).set(bearer(b)).expect(200)).body as R;
    expect([r.documento, r.produto, r.peca, r.contrato].map((x) => x?.length)).toEqual([0, 0, 0, 0]);
    await http().get(url(empB, 'q=ambulancia')).set(bearer(a)).expect(404);
  });
});
