import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Checklist documental por edital (Fase 03, RF-03.10): exigências por função, resultado só lido (quem calcula é o worker),
// permissão do módulo documentos e A x B de cada endpoint.
describe('checklist documental: fluxo e A x B', () => {
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
  const jobs = async (ac: string) => Number((await admin.query<{ n: string }>(
    `select count(*) as n from ops.jobs where tipo = 'checklist_documental' and payload ->> 'acompanhamento_id' = $1`, [ac])).rows[0]?.n);

  let empA: string; let empB: string; let a: string; let b: string; let leitor: string; let semDocs: string;
  let acA: string; let acB: string; let cnd: string; let balanco: string; let exigencia: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Checklist A'); empB = await criarEmpresa('Checklist B');
    const [eA, eB, eL, eS] = await Promise.all([criarUsuario('ck-a'), criarUsuario('ck-b'), criarUsuario('ck-l'), criarUsuario('ck-s')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eL, empA, 'OPERADOR', ['documentos:visualizar']);
    await vincular(eS, empA, 'OPERADOR', ['agenda:visualizar']);
    [a, b, leitor, semDocs] = await Promise.all([entrar(eA), entrar(eB), entrar(eL), entrar(eS)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Checklist', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    const edital = (await admin.query<{ id: string }>(
      `insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) values ($1, $2, $3, 'Objeto', repeat('c', 64)) returning id`, [fonte, `CK-${crypto.randomUUID()}`, orgao])).rows[0]?.id;
    acA = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empA, edital])).rows[0]?.id ?? '';
    acB = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empB, edital])).rows[0]?.id ?? '';
    cnd = (await admin.query<{ id: string }>(`select id from pub.tipos_documento where slug = 'cnd_federal'`)).rows[0]?.id ?? '';
    balanco = (await admin.query<{ id: string }>(`select id from pub.tipos_documento where slug = 'balanco'`)).rows[0]?.id ?? '';
  });
  afterAll(async () => {
    await app.close();
  });

  it('cadastra exigências (valida o corpo), uma por tipo, e enfileira o recálculo', async () => {
    await http().post(`/empresas/${empA}/acompanhamentos/${acA}/checklist/exigencias`).set(bearer(a)).send({ tipoId: 'x' }).expect(400);
    await http().post(`/empresas/${empA}/acompanhamentos/${acA}/checklist/exigencias`).set(bearer(a)).send({ tipoId: cnd, situacao: 'valido' }).expect(400); // corpo estrito
    await http().post(`/empresas/${empA}/acompanhamentos/${acA}/checklist/exigencias`).set(bearer(a)).send({ tipoId: crypto.randomUUID() }).expect(400); // tipo inexistente
    await http().post(`/empresas/${empA}/acompanhamentos/${crypto.randomUUID()}/checklist/exigencias`).set(bearer(a)).send({ tipoId: cnd }).expect(404);
    const antes = await jobs(acA);
    const r = await http().post(`/empresas/${empA}/acompanhamentos/${acA}/checklist/exigencias`).set(bearer(a)).send({ tipoId: cnd, observacao: 'Item 8.2' }).expect(201);
    exigencia = (r.body as { id: string }).id;
    expect(r.body).toEqual({ id: exigencia, status: 'recalculando' });
    const r2 = await http().post(`/empresas/${empA}/acompanhamentos/${acA}/checklist/exigencias`).set(bearer(a)).send({ tipoId: cnd, conferenciaManual: true }).expect(201);
    expect((r2.body as { id: string }).id).toBe(exigencia); // mesmo tipo = mesma exigência
    await http().post(`/empresas/${empA}/acompanhamentos/${acA}/checklist/exigencias`).set(bearer(a)).send({ tipoId: balanco, aplicavel: false }).expect(201);
    expect(await jobs(acA)).toBe(antes + 3);
  });

  it('lê o checklist com a situação gravada pelo worker; item sem cálculo aparece recalculando', async () => {
    const vazio = (await http().get(`/empresas/${empA}/acompanhamentos/${acA}/checklist`).set(bearer(leitor)).expect(200)).body as { calculadoEm: string | null; itens: { id: string; regularidadeFiscal: boolean; conferenciaManual: boolean; situacao: string | null; recalculando: boolean }[] };
    expect(vazio.calculadoEm).toBeNull();
    const item = vazio.itens.find((i) => i.id === exigencia);
    expect(item).toMatchObject({ regularidadeFiscal: true, conferenciaManual: true, situacao: null, recalculando: true });
    // simula o worker (a API não calcula)
    await admin.query(
      `insert into priv.checklist_resultados (empresa_id, exigencia_id, situacao, aviso, data_referencia, data_sessao, sessao_confirmada, me_epp, calculado_em)
       values ($1, $2, 'depende_conferencia', null, '2026-11-07', '2026-12-10', true, false, now() + interval '1 second')`, [empA, exigencia]);
    const d = (await http().get(`/empresas/${empA}/acompanhamentos/${acA}/checklist`).set(bearer(leitor)).expect(200)).body as { dataSessao: string; sessaoConfirmada: boolean; meEpp: boolean; itens: { id: string; tipoSlug: string; situacao: string | null; recalculando: boolean; aplicavel: boolean }[] };
    expect([d.dataSessao, d.sessaoConfirmada, d.meEpp]).toEqual(['2026-12-10', true, false]);
    expect(d.itens.map((i) => [i.tipoSlug, i.situacao, i.recalculando])).toEqual([['balanco', null, true], ['cnd_federal', 'depende_conferencia', false]]);
  });

  it('sem permissão: leitor não edita nem recalcula; quem não tem documentos não lê', async () => {
    await http().post(`/empresas/${empA}/acompanhamentos/${acA}/checklist/exigencias`).set(bearer(leitor)).send({ tipoId: cnd }).expect(404);
    await http().post(`/empresas/${empA}/acompanhamentos/${acA}/checklist/recalcular`).set(bearer(leitor)).expect(404);
    await http().delete(`/empresas/${empA}/checklist/exigencias/${exigencia}`).set(bearer(leitor)).expect(404);
    await http().get(`/empresas/${empA}/acompanhamentos/${acA}/checklist`).set(bearer(semDocs)).expect(404);
  });

  it('A x B: B não lê, não cadastra, não recalcula nem remove o checklist de A', async () => {
    await http().get(`/empresas/${empA}/acompanhamentos/${acA}/checklist`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/acompanhamentos/${acA}/checklist/exigencias`).set(bearer(b)).send({ tipoId: cnd }).expect(404);
    await http().post(`/empresas/${empA}/acompanhamentos/${acA}/checklist/recalcular`).set(bearer(b)).expect(404);
    await http().delete(`/empresas/${empA}/checklist/exigencias/${exigencia}`).set(bearer(b)).expect(404);
    // pela própria empresa, com ids de A: nada vaza nem muda
    const viaB = (await http().get(`/empresas/${empB}/acompanhamentos/${acA}/checklist`).set(bearer(b)).expect(200)).body as { itens: unknown[] };
    expect(viaB.itens).toEqual([]);
    await http().post(`/empresas/${empB}/acompanhamentos/${acA}/checklist/exigencias`).set(bearer(b)).send({ tipoId: cnd }).expect(404);
    await http().post(`/empresas/${empB}/acompanhamentos/${acA}/checklist/recalcular`).set(bearer(b)).expect(404);
    await http().delete(`/empresas/${empB}/checklist/exigencias/${exigencia}`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empB}/acompanhamentos/${acB}/checklist/exigencias`).set(bearer(b)).send({ tipoId: cnd }).expect(201);
    expect((await admin.query(`select 1 from priv.checklist_exigencias where id = $1 and deleted_at is null`, [exigencia])).rowCount).toBe(1);
  });

  it('recalcular enfileira; remover tira a exigência da lista', async () => {
    const antes = await jobs(acA);
    expect((await http().post(`/empresas/${empA}/acompanhamentos/${acA}/checklist/recalcular`).set(bearer(a)).expect(202)).body).toEqual({ status: 'recalculando' });
    expect(await jobs(acA)).toBe(antes + 1);
    await http().delete(`/empresas/${empA}/checklist/exigencias/${exigencia}`).set(bearer(a)).expect(204);
    await http().delete(`/empresas/${empA}/checklist/exigencias/${exigencia}`).set(bearer(a)).expect(404);
    const d = (await http().get(`/empresas/${empA}/acompanhamentos/${acA}/checklist`).set(bearer(a)).expect(200)).body as { itens: { tipoSlug: string }[] };
    expect(d.itens.map((i) => i.tipoSlug)).toEqual(['balanco']);
  });
});
