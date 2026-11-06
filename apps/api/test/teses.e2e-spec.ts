import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Banco de teses e indicadores da Fase 10 (10.8/10.9): criar/aprovar com permissões, uso numa peça, deferimento por tese e A x B.
describe('teses e indicadores: fluxo e A x B', () => {
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

  let empA: string; let empB: string; let a: string; let b: string; let redator: string; let leitor: string;
  let acomp: string; let peca: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Tese A'); empB = await criarEmpresa('Tese B');
    const [eA, eB, eR, eL] = await Promise.all([criarUsuario('te-a'), criarUsuario('te-b'), criarUsuario('te-r'), criarUsuario('te-l')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eR, empA, 'JURIDICO', ['juridico:visualizar', 'juridico:elaborar_peca', 'agenda:visualizar']);
    await vincular(eL, empA, 'OPERADOR', ['juridico:visualizar', 'agenda:visualizar']);
    [a, b, redator, leitor] = await Promise.all([entrar(eA), entrar(eB), entrar(eR), entrar(eL)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Tese', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values ($1, $2, $3, '3/2026', 'Objeto', repeat('1', 64)) returning id`, [fonte, `TE-${crypto.randomUUID()}`, orgao])).rows[0]?.id;
    acomp = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empA, edital])).rows[0]?.id ?? '';
    peca = (await admin.query<{ id: string }>(`insert into priv.pecas (empresa_id, acompanhamento_id, tipo, titulo) values ($1, $2, 'impugnacao', 'Impugnação ao item 3') returning id`, [empA, acomp])).rows[0]?.id ?? '';
  });
  afterAll(async () => {
    await app.close();
  });

  it('tese: criar (elaborar), aprovar só após a conferência e por quem aprova; usar só aprovada; indicadores por tese', async () => {
    const base = `/empresas/${empA}/juridico`;
    const nova = { tipo: 'impugnacao', titulo: 'Marca única', texto: 'A exigência de marca específica sem justificativa restringe a competitividade, conforme o art. 165.' };
    await http().post(`${base}/teses`).set(bearer(leitor)).send(nova).expect(404); // só visualizar
    await http().post(`${base}/teses`).set(bearer(redator)).send({ ...nova, texto: 'curta' }).expect(400);
    const tese = ((await http().post(`${base}/teses`).set(bearer(redator)).send(nova).expect(201)).body as { id: string }).id;
    expect((await admin.query<{ n: string }>(`select count(*) n from ops.jobs where tipo = 'validar_tese' and empresa_id = $1`, [empA])).rows[0]?.n).toBe('1'); // a API não confere citações
    await http().post(`${base}/teses/${tese}/aprovar`).set(bearer(redator)).expect(404); // aprovar é de quem aprova peças
    await http().post(`${base}/teses/${tese}/aprovar`).set(bearer(a)).expect(400); // o worker ainda não conferiu
    await http().post(`${base}/pecas/${peca}/teses/${tese}`).set(bearer(redator)).expect(400); // rascunho não se usa
    await admin.query(`update priv.teses set validada_em = now(), bloqueada = false where id = $1`, [tese]); // o worker faria isto
    await http().post(`${base}/teses/${tese}/aprovar`).set(bearer(a)).expect(204);
    const das = (await http().get(`${base}/pecas/${peca}/teses`).set(bearer(leitor)).expect(200)).body as { id: string; usada: boolean }[];
    expect(das.map((t) => [t.id, t.usada])).toEqual([[tese, false]]);
    await http().post(`${base}/pecas/${peca}/teses/${tese}`).set(bearer(leitor)).expect(404);
    await http().post(`${base}/pecas/${peca}/teses/${tese}`).set(bearer(redator)).expect(204);
    await http().post(`${base}/pecas/${peca}/teses/${tese}`).set(bearer(redator)).expect(204); // idempotente
    // a peça foi protocolada e deferida: a tese soma um uso e um deferimento
    await admin.query(`update priv.pecas set status = 'respondida', resultado = 'deferido', protocolo_numero = '1/2026', protocolado_em = now() where id = $1`, [peca]);
    const lista = (await http().get(`${base}/teses`).set(bearer(leitor)).expect(200)).body as { id: string; usos: number; respondidas: number; deferidas: number }[];
    expect(lista.map((t) => [t.id, t.usos, t.respondidas, t.deferidas])).toEqual([[tese, 1, 1, 1]]);
    const ind = (await http().get(`${base}/indicadores`).set(bearer(leitor)).expect(200)).body as { elaboradas: number; protocoladas: number; respondidas: number; deferidas: number; porTipo: { tipo: string; taxa: string | null }[]; porTese: { id: string; taxa: string | null }[] };
    expect([ind.elaboradas, ind.protocoladas, ind.respondidas, ind.deferidas]).toEqual([1, 1, 1, 1]);
    expect(ind.porTipo.find((t) => t.tipo === 'impugnacao')?.taxa).toBe('100.0');
    expect(ind.porTese.map((t) => [t.id, t.taxa])).toEqual([[tese, '100.0']]);
    await http().get(`${base}/indicadores?ano=2001`).set(bearer(leitor)).expect(200);
    // Excel dos indicadores: exige juridico/exportar (leitor e redator não têm), o administrador baixa um pacote .xlsx
    await http().get(`${base}/indicadores.xlsx`).set(bearer(leitor)).expect(404);
    const xl = (await http().get(`${base}/indicadores.xlsx`).set(bearer(a)).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => { cb(null, Buffer.concat(c)); }); }).expect(200));
    expect(xl.headers['content-type']).toContain('spreadsheetml.sheet');
    expect((xl.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    await http().put(`${base}/teses/${tese}`).set(bearer(redator)).send({ titulo: 'Marca única (revisada)', texto: 'Texto revisado do argumento, sem citar lei, só a competitividade.' }).expect(204);
    expect(((await http().get(`${base}/teses`).set(bearer(leitor)).expect(200)).body as { status: string }[])[0]?.status).toBe('rascunho'); // editar derruba a aprovação
    await http().post(`${base}/teses/${tese}/arquivar`).set(bearer(redator)).expect(404);
    await http().post(`${base}/teses/${tese}/arquivar`).set(bearer(a)).expect(204);
  });

  it('A x B: B não vê nem altera teses e indicadores de A', async () => {
    const base = `/empresas/${empA}/juridico`;
    const tese = (await admin.query<{ id: string }>(`select id from priv.teses where empresa_id = $1`, [empA])).rows[0]?.id ?? '';
    await http().get(`${base}/teses`).set(bearer(b)).expect(404);
    await http().get(`${base}/indicadores`).set(bearer(b)).expect(404);
    await http().get(`${base}/pecas/${peca}/teses`).set(bearer(b)).expect(404);
    expect(((await http().get(`/empresas/${empB}/juridico/teses`).set(bearer(b)).expect(200)).body as unknown[])).toHaveLength(0);
    expect((await http().get(`/empresas/${empB}/juridico/indicadores`).set(bearer(b)).expect(200)).body).toMatchObject({ elaboradas: 0, porTese: [] });
    await http().post(`${base}/teses`).set(bearer(b)).send({ tipo: 'recurso', titulo: 'Invasor', texto: 'Texto de invasão com mais de vinte caracteres.' }).expect(404);
    await http().put(`${base}/teses/${tese}`).set(bearer(b)).send({ titulo: 'Invasor', texto: 'Texto de invasão com mais de vinte caracteres.' }).expect(404);
    await http().post(`${base}/teses/${tese}/aprovar`).set(bearer(b)).expect(404);
    await http().post(`${base}/pecas/${peca}/teses/${tese}`).set(bearer(b)).expect(404);
    await http().put(`/empresas/${empB}/juridico/teses/${tese}`).set(bearer(b)).send({ titulo: 'Invasor', texto: 'Texto de invasão com mais de vinte caracteres.' }).expect(404);
    await http().post(`/empresas/${empB}/juridico/pecas/${peca}/teses/${tese}`).set(bearer(b)).expect(400);
  });
});
