import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Contratos da Fase 11: saldos calculados, limites, financeiro com sigilo, histórico e A x B.
describe('contratos: saldos, financeiro e A x B', () => {
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

  let empA: string; let empB: string; let a: string; let b: string; let operador: string;
  let ct: string; let item: string; let emp: string; let empItem: string; let nf: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Contrato A'); empB = await criarEmpresa('Contrato B');
    const [eA, eB, eO] = await Promise.all([criarUsuario('co-a'), criarUsuario('co-b'), criarUsuario('co-o')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eO, empA, 'OPERADOR', ['contratos:visualizar', 'contratos:cadastrar', 'contratos:editar']); // sem financeiro
    [a, b, operador] = await Promise.all([entrar(eA), entrar(eB), entrar(eO)]);
  });
  afterAll(async () => {
    await app.close();
  });

  it('cria o contrato e itens; o valor total é a soma dos itens e dinheiro só entra como string', async () => {
    const c = { numero: 'CT-9/2026', orgao: 'Prefeitura X', objeto: 'Fornecimento de veículos', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31', gestorOrgao: 'Fulano', fiscalOrgao: 'Beltrano', garantiaValor: '5000', garantiaAte: '2027-01-31' };
    await http().post(`/empresas/${empA}/contratos`).set(bearer(b)).send(c).expect(404);
    await http().post(`/empresas/${empA}/contratos`).set(bearer(a)).send({ ...c, vigenciaFim: '2025-12-31' }).expect(400);
    await http().post(`/empresas/${empA}/contratos`).set(bearer(a)).send({ ...c, garantiaValor: 5000 }).expect(400); // number não é aceito
    ct = ((await http().post(`/empresas/${empA}/contratos`).set(bearer(operador)).send(c).expect(201)).body as { id: string }).id;
    await http().post(`/empresas/${empA}/contratos`).set(bearer(a)).send(c).expect(409); // número repetido
    item = ((await http().post(`/empresas/${empA}/contratos/${ct}/itens`).set(bearer(operador)).send({ numeroItem: 1, descricao: 'Veículo utilitário', unidade: 'UN', quantidade: '10', valorUnitario: '90000.50' }).expect(201)).body as { id: string }).id;
    const d = (await http().get(`/empresas/${empA}/contratos/${ct}`).set(bearer(operador)).expect(200)).body as { contrato: { valorTotal: string }; itens: { saldoAEmpenhar: string }[] };
    expect([d.contrato.valorTotal, d.itens[0]?.saldoAEmpenhar]).toEqual(['900005.0000', '10.0000']);
  });

  it('empenho e entrega respeitam os saldos; as etapas ficam no histórico', async () => {
    const corpo = (n: string, q: string) => ({ numero: n, emitidoEm: '2026-02-01', prazoEntrega: '2026-03-01', itens: [{ contratoItemId: item, quantidade: q }] });
    emp = ((await http().post(`/empresas/${empA}/contratos/${ct}/empenhos`).set(bearer(operador)).send(corpo('EMP-1', '6')).expect(201)).body as { id: string }).id;
    const r = await http().post(`/empresas/${empA}/contratos/${ct}/empenhos`).set(bearer(operador)).send(corpo('EMP-2', '5')).expect(400);
    expect(JSON.stringify(r.body)).toContain('saldo');
    await http().post(`/empresas/${empA}/empenhos/${emp}/etapa`).set(bearer(operador)).send({ etapa: 'nota_emitida', observacao: 'NF emitida' }).expect(204);
    await http().post(`/empresas/${empA}/empenhos/${emp}/etapa`).set(bearer(operador)).send({ etapa: 'voando' }).expect(400);
    const d = (await http().get(`/empresas/${empA}/contratos/${ct}`).set(bearer(operador)).expect(200)).body as { empenhos: { id: string; etapa: string; etapas: unknown[]; itens: { id: string }[] }[]; itens: { empenhado: string; saldoAEmpenhar: string }[] };
    empItem = d.empenhos[0]?.itens[0]?.id ?? '';
    expect([d.empenhos[0]?.etapa, d.empenhos[0]?.etapas.length, d.itens[0]?.empenhado, d.itens[0]?.saldoAEmpenhar]).toEqual(['nota_emitida', 2, '6.0000', '4.0000']);
    await http().post(`/empresas/${empA}/empenho-itens/${empItem}/entregas`).set(bearer(operador)).send({ quantidade: '4', data: '2026-03-10', recebimento: 'provisorio' }).expect(201);
    await http().post(`/empresas/${empA}/empenho-itens/${empItem}/entregas`).set(bearer(operador)).send({ quantidade: '3', data: '2026-03-11' }).expect(400); // saldo empenhado é 2
  });

  it('financeiro: faturar e receber em parcelas, com sigilo para quem não tem financeiro', async () => {
    const f = { numeroNf: 'NF-100', emitidaEm: '2026-03-12', valor: '360000.20', retencoes: '8000', vencimento: '2026-04-12', empenhoId: emp };
    await http().post(`/empresas/${empA}/contratos/${ct}/faturas`).set(bearer(operador)).send(f).expect(404); // sem financeiro/editar
    nf = ((await http().post(`/empresas/${empA}/contratos/${ct}/faturas`).set(bearer(a)).send(f).expect(201)).body as { id: string }).id;
    await http().post(`/empresas/${empA}/contratos/${ct}/faturas`).set(bearer(a)).send({ ...f, numeroNf: 'NF-101', valor: '600000' }).expect(400); // acima do saldo do contrato
    const antes = (await http().get(`/empresas/${empA}/contratos/${ct}`).set(bearer(a)).expect(200)).body as { faturas: { aReceber: string; diasAtraso: number }[]; alertas: { tipo: string }[] };
    expect(antes.faturas[0]?.aReceber).toBe('352000.2000'); // 360.000,20 - 8.000 de retenção informada
    expect(antes.faturas[0]?.diasAtraso).toBeGreaterThan(0); // vencida e sem pagamento
    expect(antes.alertas.some((x) => x.tipo === 'pagamento')).toBe(true);
    await http().post(`/empresas/${empA}/faturas/${nf}/pagamento`).set(bearer(a)).send({ pagoEm: '2026-04-20', valorRecebido: '999999' }).expect(400);
    await http().post(`/empresas/${empA}/faturas/${nf}/pagamento`).set(bearer(a)).send({ pagoEm: '2026-04-20', valorRecebido: '352000.20', ocorrencia: 'Retenções aplicadas pelo órgão' }).expect(204);
    const depois = (await http().get(`/empresas/${empA}/contratos/${ct}`).set(bearer(a)).expect(200)).body as { faturas: { aReceber: string; diasAtraso: number }[]; alertas: { tipo: string }[] };
    expect([depois.faturas[0]?.aReceber, depois.faturas[0]?.diasAtraso, depois.alertas.some((x) => x.tipo === 'pagamento')]).toEqual(['0.0000', 0, false]);
    const op = (await http().get(`/empresas/${empA}/contratos/${ct}`).set(bearer(operador)).expect(200)).body as { faturas: unknown };
    expect(op.faturas).toBeNull(); // sem financeiro/visualizar: nada de valores (e nenhum zero enganoso)
    const lista = (await http().get(`/empresas/${empA}/contratos`).set(bearer(operador)).expect(200)).body as { veFinanceiro: boolean; empenhado: string }[];
    expect([lista[0]?.veFinanceiro, lista[0]?.empenhado]).toEqual([false, '540003.0000']); // 6 x 90.000,50
  });

  it('histórico: aditivo atualiza valor e vigência; encerrar só contrato ativo e bloqueia novos empenhos', async () => {
    await http().post(`/empresas/${empA}/contratos/${ct}/eventos`).set(bearer(operador)).send({ tipo: 'aditivo', data: '2026-06-01', descricao: 'Aditivo de valor e prazo', novoValor: '1000000', novaVigencia: '2027-06-30' }).expect(201);
    await http().post(`/empresas/${empA}/contratos/${ct}/eventos`).set(bearer(operador)).send({ tipo: 'prorrogacao', data: '2026-06-02', descricao: 'Voltando a vigência', novaVigencia: '2026-01-01' }).expect(400);
    const d = (await http().get(`/empresas/${empA}/contratos/${ct}`).set(bearer(operador)).expect(200)).body as { contrato: { valorTotal: string; vigenciaFim: string }; eventos: { tipo: string; valorAntes: string | null; valorDepois: string | null }[] };
    expect([d.contrato.valorTotal, d.contrato.vigenciaFim, d.eventos[0]?.valorAntes, d.eventos[0]?.valorDepois]).toEqual(['1000000.0000', '2027-06-30', '900005.0000', '1000000.0000']);
    await http().post(`/empresas/${empA}/contratos/${ct}/encerrar`).set(bearer(operador)).send({ status: 'encerrado' }).expect(204);
    await http().post(`/empresas/${empA}/contratos/${ct}/encerrar`).set(bearer(operador)).send({ status: 'encerrado' }).expect(400);
    await http().post(`/empresas/${empA}/contratos/${ct}/empenhos`).set(bearer(operador)).send({ numero: 'EMP-9', emitidoEm: '2026-07-01', itens: [{ contratoItemId: item, quantidade: '1' }] }).expect(404); // contrato não está ativo
  });

  it('contratada sem contrato aparece como pendente de cadastro com os dados do edital; cadastrar com o acompanhamento tira da lista; A x B', async () => {
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Prefeitura Contratante', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values ($1, $2, $3, '7/2026', 'Aquisição de veículos', repeat('1', 64)) returning id`, [fonte, `CT-${crypto.randomUUID()}`, orgao])).rows[0]?.id;
    const it = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao, quantidade, unidade_medida) values ($1, 1, 'Veículo utilitário', 4, 'UN') returning id`, [edital])).rows[0]?.id;
    const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empA, edital])).rows[0]?.id ?? '';
    const part = (await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values ($1, $2, $3) returning id`, [empA, ac, it])).rows[0]?.id;
    await admin.query(`insert into priv.resultados_item (empresa_id, participacao_id, resultado_final, valor_final) values ($1, $2, 'contratada', 85000.5)`, [empA, part]);
    const base = `/empresas/${empA}/contratos/pendentes-de-cadastro`;
    await http().get(base).set(bearer(b)).expect(404);
    await http().get(base).set(bearer(operador)).expect(404); // sem agenda/visualizar a RLS esconderia as linhas
    const l = (await http().get(base).set(bearer(a)).expect(200)).body as { acompanhamentoId: string; orgao: string; numeroEdital: string; descricao: string; quantidade: string; valorFinal: string }[];
    expect(l.map((x) => [x.acompanhamentoId, x.orgao, x.numeroEdital, x.descricao, x.quantidade, x.valorFinal])).toEqual([[ac, 'Prefeitura Contratante', '7/2026', 'Veículo utilitário', '4.0000', '85000.5000']]);
    const c = { numero: 'CT-77/2026', orgao: 'Prefeitura Contratante', objeto: 'Aquisição de veículos', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31', acompanhamentoId: ac };
    await http().post(`/empresas/${empA}/contratos`).set(bearer(operador)).send(c).expect(201);
    expect(((await http().get(base).set(bearer(a)).expect(200)).body as unknown[])).toHaveLength(0);
    expect((await http().get(`/empresas/${empB}/contratos/pendentes-de-cadastro`).set(bearer(b)).expect(200)).body).toEqual([]);
  });

  it('A x B: B não lê nem altera nada de A, nem descobre ids', async () => {
    await http().get(`/empresas/${empA}/contratos`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empA}/contratos/${ct}`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/contratos/${ct}/itens`).set(bearer(b)).send({ numeroItem: 2, descricao: 'x', quantidade: '1', valorUnitario: '1' }).expect(404);
    await http().post(`/empresas/${empA}/empenhos/${emp}/etapa`).set(bearer(b)).send({ etapa: 'concluido' }).expect(404);
    await http().post(`/empresas/${empA}/faturas/${nf}/pagamento`).set(bearer(b)).send({ pagoEm: '2026-04-20', valorRecebido: '1' }).expect(404);
    // empresa de B na rota com ids de A: nada é encontrado nem revelado
    await http().get(`/empresas/${empB}/contratos/${ct}`).set(bearer(b)).expect(404);
    expect(((await http().get(`/empresas/${empB}/contratos`).set(bearer(b)).expect(200)).body as unknown[])).toHaveLength(0);
    await http().post(`/empresas/${empB}/empenho-itens/${empItem}/entregas`).set(bearer(b)).send({ quantidade: '1', data: '2026-03-12' }).expect(404);
    await http().post(`/empresas/${empB}/faturas/${nf}/pagamento`).set(bearer(b)).send({ pagoEm: '2026-04-20', valorRecebido: '1' }).expect(400);
  });
});
