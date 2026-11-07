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

  it('exporta .ics da empresa (anexo text/calendar) e B não baixa o de A', async () => {
    const r = await http().get(`/empresas/${empA}/agenda/calendario.ics?acompanhamento=${acomp}`).set(bearer(a)).expect(200);
    expect(r.headers['content-type']).toContain('text/calendar');
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.text).toContain(`UID:${evento}@vv-licitacoes`);
    await http().get(`/empresas/${empA}/agenda/calendario.ics`).set(bearer(b)).expect(404);
  });

  it('exporta CSV só com agenda/exportar; leitor e outra empresa recebem 404', async () => {
    const r = await http().get(`/empresas/${empA}/agenda/eventos.csv?acompanhamento=${acomp}`).set(bearer(a)).expect(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.text.startsWith('\uFEFFPrazo (Brasília);')).toBe(true);
    await http().get(`/empresas/${empA}/agenda/eventos.csv`).set(bearer(leitor)).expect(404);
    await http().get(`/empresas/${empA}/agenda/eventos.csv`).set(bearer(b)).expect(404);
  });

  it('configuração da agenda: feriado próprio, parâmetro D-N e A x B', async () => {
    const f = { data: '2026-12-14', nome: 'Feriado municipal (teste)', abrangencia: 'municipio', uf: 'PR', codigoIbge: '4106902' };
    const criado = await http().post(`/empresas/${empA}/agenda/feriados`).set(bearer(a)).send(f).expect(201);
    await http().post(`/empresas/${empA}/agenda/feriados`).set(bearer(a)).send(f).expect(409);
    await http().post(`/empresas/${empA}/agenda/feriados`).set(bearer(a)).send({ ...f, data: '2026-12-15', codigoIbge: null }).expect(400);
    await http().post(`/empresas/${empA}/agenda/feriados`).set(bearer(leitor)).send({ ...f, data: '2026-12-16' }).expect(404);
    await http().post(`/empresas/${empA}/agenda/parametros`).set(bearer(a)).send({ diasInternos: 11 }).expect(400);
    await http().post(`/empresas/${empA}/agenda/parametros`).set(bearer(leitor)).send({ diasInternos: 3 }).expect(404);
    await http().post(`/empresas/${empA}/agenda/parametros`).set(bearer(a)).send({ diasInternos: 3 }).expect(204);
    const cfg = (await http().get(`/empresas/${empA}/agenda/configuracao`).set(bearer(a)).expect(200)).body as { diasInternos: number; feriados: { id: string }[] };
    expect(cfg.diasInternos).toBe(3);
    expect(cfg.feriados.map((x) => x.id)).toEqual([(criado.body as { id: string }).id]);
    await http().get(`/empresas/${empA}/agenda/configuracao`).set(bearer(b)).expect(404);
    await http().delete(`/empresas/${empA}/agenda/feriados/${(criado.body as { id: string }).id}`).set(bearer(b)).expect(404);
    const cfgB = (await http().get(`/empresas/${empB}/agenda/configuracao`).set(bearer(b)).expect(200)).body as { diasInternos: number; feriados: unknown[] };
    expect([cfgB.diasInternos, cfgB.feriados.length]).toEqual([2, 0]); // B não herda nada de A
    await http().delete(`/empresas/${empA}/agenda/feriados/${(criado.body as { id: string }).id}`).set(bearer(a)).expect(204);
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

  // Matriz explícita de todas as 20 rotas do AgendaController, nos dois sentidos.
  for (const dona of ['A', 'B'] as const) {
    it(`isolamento por endpoint: empresa ${dona} preservada contra a outra empresa`, async () => {
      const empresa = dona === 'A' ? empA : empB;
      const outra = dona === 'A' ? empB : empA;
      const token = dona === 'A' ? a : b;
      const invasor = dona === 'A' ? b : a;
      const get = async (path: string) => (await http().get(`/empresas/${empresa}/${path}`).set(bearer(token)).expect(200)).body as unknown;
      const id = ((await http().post(`/empresas/${empresa}/acompanhamentos`).set(bearer(token)).send({ editalId }).expect(201)).body as { id: string }).id;
      await http().post(`/empresas/${empresa}/acompanhamentos/${id}/participacoes`).set(bearer(token)).send({ itemIds: [itemIds[7]] }).expect(201);
      const detalhe = await get(`acompanhamentos/${id}`) as { itens: { participacaoId: string | null }[] };
      const pid = detalhe.itens.find((i) => i.participacaoId)?.participacaoId ?? '';
      const ev = (await admin.query<{ id: string }>(`insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, data_limite_legal) values ($1, $2, 'esclarecimento', '2026-12-20') returning id`, [empresa, id])).rows[0]?.id ?? '';
      const feriado = { data: '2026-12-24', nome: 'Feriado fictício isolamento', abrangencia: 'uf', uf: 'PR' };
      const fid = ((await http().post(`/empresas/${empresa}/agenda/feriados`).set(bearer(token)).send(feriado).expect(201)).body as { id: string }).id;
      const op = (await admin.query<{ id: string }>(`insert into priv.oportunidades (empresa_id, edital_id, item_id, nota, faixa, versao_regra, edital_versao) values ($1, $2, $3, 80, 'alta', 'teste', 1) returning id`, [empresa, editalId, itemIds[6]])).rows[0]?.id ?? '';
      const responsavel = (await get('agenda/responsaveis') as { id: string }[])[0]?.id ?? '';
      const antes = await get(`acompanhamentos/${id}`);
      const cfg = await get('agenda/configuracao');
      const rotas: { metodo: 'get' | 'post' | 'patch' | 'delete'; path: string; corpo?: object; recurso?: boolean }[] = [
        ...['responsaveis', 'eventos', 'calendario.ics', 'configuracao', 'eventos.csv', 'acompanhamentos'].map((p) => ({ metodo: 'get' as const, path: `agenda/${p}` })),
        { metodo: 'get', path: `acompanhamentos/${id}`, recurso: true },
        { metodo: 'post', path: 'agenda/feriados', corpo: { ...feriado, data: '2026-12-25' } },
        { metodo: 'delete', path: `agenda/feriados/${fid}`, recurso: true },
        { metodo: 'post', path: 'agenda/parametros', corpo: { diasInternos: 9 } },
        { metodo: 'post', path: 'acompanhamentos', corpo: { editalId } },
        { metodo: 'post', path: `oportunidades/${op}/acompanhar`, recurso: true },
        { metodo: 'post', path: `acompanhamentos/${id}/abertura`, corpo: { data: '2026-12-22T10:00:00-03:00', origem: 'edital' }, recurso: true },
        { metodo: 'patch', path: `acompanhamentos/${id}`, corpo: { prioridade: 'urgente' }, recurso: true },
        { metodo: 'post', path: `acompanhamentos/${id}/participacoes`, corpo: { itemIds: [itemIds[6]] }, recurso: true },
        { metodo: 'patch', path: `participacoes/${pid}`, corpo: { marca: 'Invasão fictícia' }, recurso: true },
        { metodo: 'post', path: `acompanhamentos/${id}/fatos`, corpo: { tipo: 'intencao_recurso', dataBase: '2026-12-22T10:00:00-03:00' }, recurso: true },
        { metodo: 'post', path: `eventos/${ev}/status`, corpo: { status: 'em_elaboracao' }, recurso: true },
        { metodo: 'post', path: `eventos/${ev}/prazo`, corpo: { dataLimite: '2026-12-22T10:00:00-03:00', justificativa: 'Tentativa fictícia de alteração' }, recurso: true },
        { metodo: 'post', path: `eventos/${ev}/responsavel`, corpo: { responsavelId: responsavel }, recurso: true },
      ];
      for (const rota of rotas) {
        await http()[rota.metodo](`/empresas/${empresa}/${rota.path}`).set(bearer(invasor)).send(rota.corpo ?? {}).expect(404);
        if (rota.recurso) await http()[rota.metodo](`/empresas/${outra}/${rota.path}`).set(bearer(invasor)).send(rota.corpo ?? {}).expect(404);
      }
      expect(await get(`acompanhamentos/${id}`)).toEqual(antes);
      expect(await get('agenda/configuracao')).toEqual(cfg);
      const outrosResponsaveis = (await http().get(`/empresas/${outra}/agenda/responsaveis`).set(bearer(invasor)).expect(200)).body as { id: string }[];
      expect(outrosResponsaveis.map((r) => r.id)).not.toContain(responsavel);
      const outraCfg = (await http().get(`/empresas/${outra}/agenda/configuracao`).set(bearer(invasor)).expect(200)).body as { feriados: { id: string }[] };
      expect(outraCfg.feriados.map((f) => f.id)).not.toContain(fid);
      expect((await admin.query(`select triagem from priv.oportunidades where id = $1`, [op])).rows[0]).toEqual({ triagem: 'nova' });
      for (const path of ['agenda/eventos', 'agenda/acompanhamentos']) {
        const r = await http().get(`/empresas/${outra}/${path}`).set(bearer(invasor)).expect(200);
        expect(JSON.stringify(r.body)).not.toContain(id);
        expect(JSON.stringify(r.body)).not.toContain(ev);
      }
      for (const path of ['calendario.ics', 'eventos.csv']) {
        const r = await http().get(`/empresas/${outra}/agenda/${path}?acompanhamento=${id}`).set(bearer(invasor)).expect(200);
        expect(r.text).not.toContain(ev);
      }
    });
  }

});
