import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Agenda da Fase 05: fluxo (acompanhar, confirmar abertura, participações, override, status) e A x B de cada endpoint.
describe('agenda: fluxo e A x B', () => {
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

  let empA: string; let empB: string; let a: string; let b: string; let leitor: string;
  let editalId: string; let itemIds: string[]; let acomp: string; let evento: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Agenda A'); empB = await criarEmpresa('Agenda B');
    const [eA, eB, eL] = await Promise.all([criarUsuario('ag-a'), criarUsuario('ag-b'), criarUsuario('ag-l')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eL, empA, 'OPERADOR', ['agenda:visualizar', 'editais:visualizar']);
    [a, b, leitor] = await Promise.all([entrar(eA), entrar(eB), entrar(eL)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Agenda', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    editalId = (await admin.query<{ id: string }>(
      `insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo, data_encerramento_propostas)
       values ($1, $2, $3, 'Objeto da agenda', repeat('e', 64), now() + interval '30 days') returning id`, [fonte, `AGE-${crypto.randomUUID()}`, orgao])).rows[0]?.id ?? '';
    itemIds = (await admin.query<{ id: string }>(
      `insert into pub.edital_itens (edital_id, numero_item, descricao) select $1, n, 'Item ' || n from generate_series(1, 8) n returning id`, [editalId])).rows.map((r) => r.id);
  });
  afterAll(async () => {
    await app.close();
  });

  it('acompanhar é idempotente, nasce com abertura sugerida e quem só visualiza não acompanha', async () => {
    const r = await http().post(`/empresas/${empA}/acompanhamentos`).set(bearer(a)).send({ editalId }).expect(201);
    acomp = (r.body as { id: string }).id;
    expect(((await http().post(`/empresas/${empA}/acompanhamentos`).set(bearer(a)).send({ editalId }).expect(201)).body as { id: string }).id).toBe(acomp);
    await http().post(`/empresas/${empA}/acompanhamentos`).set(bearer(leitor)).send({ editalId }).expect(404); // sem a permissão o guard nem revela a empresa
    const d = (await http().get(`/empresas/${empA}/acompanhamentos/${acomp}`).set(bearer(a)).expect(200)).body as { aberturaConfirmada: boolean; itens: unknown[] };
    expect(d.aberturaConfirmada).toBe(false);
    expect(d.itens).toHaveLength(8); // cada item do edital em linha própria
  });

  it('confirmar abertura enfileira o recálculo (a API não calcula) e exige a data', async () => {
    const antes = Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'calcular_prazos'`)).rows[0]?.count);
    await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/abertura`).set(bearer(a)).send({ origem: 'edital' }).expect(400);
    await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/abertura`).set(bearer(a))
      .send({ data: '2026-12-16T10:00:00-03:00', origem: 'edital', clausula: 'item 4.1' }).expect(202);
    expect(Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'calcular_prazos'`)).rows[0]?.count)).toBe(antes + 1);
    expect((await admin.query(`select abertura_confirmada, confiabilidade from priv.acompanhamentos where id = $1`, [acomp])).rows[0]).toEqual({ abertura_confirmada: true, confiabilidade: 'alta' });
  });

  it('participações por item: criar, atualizar e dinheiro como string', async () => {
    const c = await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/participacoes`).set(bearer(a)).send({ itemIds: itemIds.slice(0, 3) }).expect(201);
    expect((c.body as { criadas: number }).criadas).toBe(3);
    expect(((await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/participacoes`).set(bearer(a)).send({ itemIds: itemIds.slice(0, 3) }).expect(201)).body as { criadas: number }).criadas).toBe(0);
    const d = (await http().get(`/empresas/${empA}/acompanhamentos/${acomp}`).set(bearer(a)).expect(200)).body as { itens: { participacaoId: string | null }[] };
    const pid = d.itens.find((i) => i.participacaoId)?.participacaoId ?? '';
    await http().patch(`/empresas/${empA}/participacoes/${pid}`).set(bearer(a)).send({ status: 'vai_participar', marca: 'Marca X', valorUnitario: '1234.5678' }).expect(204);
    await http().patch(`/empresas/${empA}/participacoes/${pid}`).set(bearer(a)).send({ valorUnitario: 12.5 }).expect(400); // number nunca
    expect((await admin.query(`select status, valor_unitario::text as v from priv.participacoes where id = $1`, [pid])).rows[0]).toEqual({ status: 'vai_participar', v: '1234.5678' });
    await http().patch(`/empresas/${empA}/participacoes/${pid}`).set(bearer(leitor)).send({ status: 'nao_vai' }).expect(404);
  });

  it('evento: status, dispensa e override exigem justificativa e vão para o histórico', async () => {
    evento = (await admin.query<{ id: string }>(
      `insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, data_limite_legal) values ($1, $2, 'impugnacao', now() + interval '10 days') returning id`, [empA, acomp])).rows[0]?.id ?? '';
    await http().post(`/empresas/${empA}/eventos/${evento}/status`).set(bearer(a)).send({ status: 'em_elaboracao' }).expect(204);
    await http().post(`/empresas/${empA}/eventos/${evento}/status`).set(bearer(a)).send({ status: 'dispensado' }).expect(400);
    await http().post(`/empresas/${empA}/eventos/${evento}/status`).set(bearer(a)).send({ status: 'dispensado', justificativa: 'Edital já foi retificado, sem objeto' }).expect(204);
    await http().post(`/empresas/${empA}/eventos/${evento}/prazo`).set(bearer(a)).send({ dataLimite: '2026-12-10T20:00:00-03:00', justificativa: 'curto' }).expect(400);
    await http().post(`/empresas/${empA}/eventos/${evento}/prazo`).set(bearer(a)).send({ dataLimite: '2026-12-10T20:00:00-03:00', justificativa: 'Cláusula 9.2 do edital fixa este prazo' }).expect(204);
    const h = (await http().get(`/empresas/${empA}/acompanhamentos/${acomp}`).set(bearer(a)).expect(200)).body as { historico: { campo: string }[] };
    expect(h.historico.map((x) => x.campo)).toEqual(expect.arrayContaining(['status', 'data_limite_legal']));
    const ev = (await http().get(`/empresas/${empA}/agenda/eventos?acompanhamento=${acomp}`).set(bearer(a)).expect(200)).body as { id: string; origemPrazo: string }[];
    expect(ev.find((e) => e.id === evento)?.origemPrazo).toBe('manual');
  });

  it('A x B: B não lê, não altera nem descobre nada da agenda de A', async () => {
    await http().get(`/empresas/${empA}/agenda/eventos`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empA}/agenda/acompanhamentos`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empA}/acompanhamentos/${acomp}`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empB}/acompanhamentos/${acomp}`).set(bearer(b)).expect(404); // pela rota de B não alcança o de A
    await http().post(`/empresas/${empA}/eventos/${evento}/status`).set(bearer(b)).send({ status: 'aprovado' }).expect(404);
    await http().post(`/empresas/${empB}/eventos/${evento}/status`).set(bearer(b)).send({ status: 'aprovado' }).expect((r) => { expect(r.status).toBeGreaterThanOrEqual(400); });
    await http().post(`/empresas/${empB}/eventos/${evento}/prazo`).set(bearer(b)).send({ dataLimite: '2026-12-10T20:00:00-03:00', justificativa: 'tentando mexer no que não é meu' }).expect((r) => { expect(r.status).toBeGreaterThanOrEqual(400); });
    await http().patch(`/empresas/${empB}/acompanhamentos/${acomp}`).set(bearer(b)).send({ prioridade: 'urgente' }).expect(404);
    expect((await admin.query(`select prioridade from priv.acompanhamentos where id = $1`, [acomp])).rows[0]).toEqual({ prioridade: 'normal' });
    expect(((await http().get(`/empresas/${empB}/agenda/eventos`).set(bearer(b)).expect(200)).body as unknown[])).toHaveLength(0);
    // B acompanha o mesmo edital público: o dele é separado.
    const rb = await http().post(`/empresas/${empB}/acompanhamentos`).set(bearer(b)).send({ editalId }).expect(201);
    expect((rb.body as { id: string }).id).not.toBe(acomp);
  });

  it('responsáveis: só com agenda/visualizar e só da própria empresa', async () => {
    expect((await http().get(`/empresas/${empA}/agenda/responsaveis`).set(bearer(leitor)).expect(200)).body).toHaveLength(2);
    await http().get(`/empresas/${empA}/agenda/responsaveis`).set(bearer(b)).expect(404);
  });
});
