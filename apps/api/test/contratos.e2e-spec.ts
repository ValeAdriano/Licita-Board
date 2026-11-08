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

  it('anexos vinculam documentos do repositório (por contrato ou etapa do empenho); pedido de reajuste/reequilíbrio abre peça do jurídico; A x B', async () => {
    const c = (await http().post(`/empresas/${empA}/contratos`).set(bearer(a)).send({ numero: 'CT-88/2026', orgao: 'Prefeitura Y', objeto: 'Fornecimento contínuo', vigenciaInicio: '2026-01-01', vigenciaFim: '2027-12-31' }).expect(201)).body as { id: string };
    const it = ((await http().post(`/empresas/${empA}/contratos/${c.id}/itens`).set(bearer(a)).send({ numeroItem: 1, descricao: 'Item', unidade: 'UN', quantidade: '10', valorUnitario: '100' }).expect(201)).body as { id: string }).id;
    const empen = ((await http().post(`/empresas/${empA}/contratos/${c.id}/empenhos`).set(bearer(a)).send({ numero: 'EMP-X', emitidoEm: '2026-02-01', itens: [{ contratoItemId: it, quantidade: '4' }] }).expect(201)).body as { id: string }).id;
    const tipo = (await admin.query<{ id: string }>(`select id from pub.tipos_documento limit 1`)).rows[0]?.id;
    const docA = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, $2, 'Certidão FGTS (execução)') returning id`, [empA, tipo])).rows[0]?.id ?? '';
    const docB = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, $2, 'Documento de B') returning id`, [empB, tipo])).rows[0]?.id ?? '';
    const base = `/empresas/${empA}/contratos/${c.id}`;
    await http().post(`${base}/anexos`).set(bearer(operador)).send({ documentoId: docA }).expect(403); // contratos/editar mas sem documentos/visualizar
    await http().post(`${base}/anexos`).set(bearer(a)).send({ documentoId: docB }).expect(404); // documento de outra empresa não existe para A
    await http().post(`${base}/anexos`).set(bearer(a)).send({ documentoId: docA, etapa: 'entrega' }).expect(400); // etapa exige empenho
    const anx = ((await http().post(`${base}/anexos`).set(bearer(a)).send({ documentoId: docA, nota: 'Regularidade' }).expect(201)).body as { id: string }).id;
    await http().post(`${base}/anexos`).set(bearer(a)).send({ documentoId: docA, empenhoId: empen, etapa: 'entrega', nota: 'Comprovante' }).expect(201);
    await http().post(`${base}/anexos`).set(bearer(a)).send({ documentoId: docA, nota: 'repetido' }).expect(409);
    const l = (await http().get(`${base}/anexos`).set(bearer(a)).expect(200)).body as { descricao: string | null; etapa: string | null }[];
    expect(l.map((x) => `${x.descricao ?? ''}|${x.etapa ?? '-'}`).sort()).toEqual(['Certidão FGTS (execução)|-', 'Certidão FGTS (execução)|entrega']);
    const semDoc = (await http().get(`${base}/anexos`).set(bearer(operador)).expect(200)).body as { descricao: string | null }[];
    expect(semDoc.map((x) => x.descricao)).toEqual([null, null]); // sem documentos/visualizar o vínculo aparece, o documento não
    await http().delete(`${base}/anexos/${anx}`).set(bearer(b)).expect(404);
    await http().delete(`${base}/anexos/${anx}`).set(bearer(a)).expect(204);
    // pedidos ao órgão: peça jurídica ligada ao contrato (precisa do edital: contrato cadastrado a partir do resultado)
    await http().post(`${base}/pedidos`).set(bearer(a)).send({ tipo: 'reajuste', titulo: 'Pedido de reajuste anual' }).expect(400);
    const ed = (await admin.query<{ id: string }>(`select a.id from priv.acompanhamentos a where a.empresa_id = $1 limit 1`, [empA])).rows[0]?.id;
    await admin.query(`update priv.contratos set acompanhamento_id = $1 where id = $2`, [ed, c.id]);
    await http().post(`${base}/pedidos`).set(bearer(a)).send({ tipo: 'recurso', titulo: 'Tipo inválido' }).expect(400);
    const ped = ((await http().post(`${base}/pedidos`).set(bearer(a)).send({ tipo: 'reajuste', titulo: 'Pedido de reajuste anual' }).expect(201)).body as { pecaId: string }).pecaId;
    const lp = (await http().get(`${base}/pedidos`).set(bearer(a)).expect(200)).body as { id: string; tipo: string; status: string }[];
    expect(lp.map((x) => [x.id, x.tipo, x.status])).toEqual([[ped, 'reajuste', 'triagem']]);
    await http().post(`${base}/pedidos`).set(bearer(operador)).send({ tipo: 'reajuste', titulo: 'Sem permissão' }).expect(404); // sem juridico/elaborar_peca
    // A x B
    await http().get(`${base}/anexos`).set(bearer(b)).expect(404);
    await http().get(`${base}/pedidos`).set(bearer(b)).expect(404);
    await http().post(`${base}/anexos`).set(bearer(b)).send({ documentoId: docB }).expect(404);
    await http().post(`${base}/pedidos`).set(bearer(b)).send({ tipo: 'reajuste', titulo: 'Invasor aqui' }).expect(404);
    await http().post(`/empresas/${empB}/contratos/${c.id}/pedidos`).set(bearer(b)).send({ tipo: 'reajuste', titulo: 'Invasor aqui' }).expect(404);
    await http().post(`/empresas/${empB}/contratos/${c.id}/anexos`).set(bearer(b)).send({ documentoId: docB }).expect(404);
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
    await http().post(`/empresas/${empB}/faturas/${nf}/pagamento`).set(bearer(b)).send({ pagoEm: '2026-04-20', valorRecebido: '1' }).expect(400); // Q-31b: ausência e saldo ainda compartilham o erro do banco
  });
  for (const dona of ['A', 'B'] as const) {
    it(`isolamento por endpoint: contratos de ${dona} intactos nas 17 rotas`, async () => {
      const empresas = [await criarEmpresa('Matriz A fictícia'), await criarEmpresa('Matriz B fictícia')] as const;
      const usuarios = [await criarUsuario('matriz-a'), await criarUsuario('matriz-b')] as const;
      await vincular(usuarios[0], empresas[0]); await vincular(usuarios[1], empresas[1]);
      const tokens = [await entrar(usuarios[0]), await entrar(usuarios[1])] as const;
      const empresa = empresas[dona === 'A' ? 0 : 1];
      const outra = empresas[dona === 'A' ? 1 : 0];
      const token = tokens[dona === 'A' ? 0 : 1];
      const invasor = tokens[dona === 'A' ? 1 : 0];
      const raiz = `/empresas/${empresa}`;
      const novoContrato = { numero: crypto.randomUUID(), orgao: 'Órgão fictício matriz', objeto: 'Objeto fictício isolado', vigenciaInicio: '2026-01-01', vigenciaFim: '2030-12-31' };
      const id = ((await http().post(`${raiz}/contratos`).set(bearer(token)).send(novoContrato).expect(201)).body as { id: string }).id;
      const itemCorpo = { numeroItem: 1, descricao: 'Item fictício', quantidade: '10', valorUnitario: '9876.5432' };
      const ci = ((await http().post(`${raiz}/contratos/${id}/itens`).set(bearer(token)).send(itemCorpo).expect(201)).body as { id: string }).id;
      const empenhoCorpo = { numero: 'EMP-matriz', emitidoEm: '2026-02-01', itens: [{ contratoItemId: ci, quantidade: '4' }] };
      const ei = ((await http().post(`${raiz}/contratos/${id}/empenhos`).set(bearer(token)).send(empenhoCorpo).expect(201)).body as { id: string }).id;
      const eitem = (await admin.query<{ id: string }>('select id from priv.empenho_itens where empenho_id = $1', [ei])).rows[0]?.id ?? '';
      const faturaCorpo = { numeroNf: 'NF-matriz', emitidaEm: '2026-03-01', valor: '12345.6789', vencimento: '2026-04-01', empenhoId: ei };
      const f = ((await http().post(`${raiz}/contratos/${id}/faturas`).set(bearer(token)).send(faturaCorpo).expect(201)).body as { id: string }).id;
      const doc = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) select $1, id, 'Documento fictício matriz' from pub.tipos_documento limit 1 returning id`, [empresa])).rows[0]?.id ?? '';
      const anexo = ((await http().post(`${raiz}/contratos/${id}/anexos`).set(bearer(token)).send({ documentoId: doc }).expect(201)).body as { id: string }).id;
      const ed = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, orgao_id, id_externo, objeto, hash_conteudo) select id, (select id from pub.orgaos limit 1), $1, 'Matriz contratos', repeat('a',64) from ops.fontes limit 1 returning id`, [crypto.randomUUID()])).rows[0]?.id;
      const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1,$2) returning id`, [empresa, ed])).rows[0]?.id;
      await admin.query('update priv.contratos set acompanhamento_id = $1 where id = $2', [ac, id]);
      await http().post(`${raiz}/contratos/${id}/pedidos`).set(bearer(token)).send({ tipo: 'reajuste', titulo: 'Pedido fictício matriz' }).expect(201);
      const pendEd = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, orgao_id, id_externo, objeto, hash_conteudo) select fonte_id, orgao_id, $2, objeto, hash_conteudo from pub.editais where id = $1 returning id`, [ed, crypto.randomUUID()])).rows[0]?.id;
      const pendAc = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1,$2) returning id`, [empresa, pendEd])).rows[0]?.id;
      const pendItem = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao) values ($1,1,'Pendente matriz') returning id`, [pendEd])).rows[0]?.id;
      const pendPa = (await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values ($1,$2,$3) returning id`, [empresa, pendAc, pendItem])).rows[0]?.id;
      await admin.query(`insert into priv.resultados_item (empresa_id, participacao_id, resultado_final, valor_final) values ($1,$2,'contratada','45678.9123')`, [empresa, pendPa]);
      expect(JSON.stringify((await http().get(`${raiz}/contratos/pendentes-de-cadastro`).set(bearer(token)).expect(200)).body)).toContain(pendAc);
      const snapshot = async () => {
        const dados: unknown[] = [];
        for (const tabela of ['contratos', 'contrato_itens', 'empenhos', 'empenho_itens', 'empenho_etapas', 'entregas', 'faturas', 'contrato_eventos', 'contrato_anexos', 'pecas', 'documentos']) {
          dados.push((await admin.query(`select to_jsonb(t) as linha from priv.${tabela} t where empresa_id = $1 order by id`, [empresa])).rows);
        }
        return dados;
      };
      const antes = await snapshot();
      const ausente = crypto.randomUUID();
      type Caso = { metodo: 'get' | 'post' | 'delete'; rota: string; corpo?: object };
      const casos: Caso[] = [
        { metodo: 'get', rota: '/contratos' },
        { metodo: 'get', rota: '/contratos/pendentes-de-cadastro' },
        { metodo: 'post', rota: '/contratos', corpo: { ...novoContrato, numero: crypto.randomUUID(), acompanhamentoId: ac } },
        { metodo: 'get', rota: `/contratos/${id}` },
        { metodo: 'get', rota: `/contratos/${id}/anexos` },
        { metodo: 'post', rota: `/contratos/${id}/anexos`, corpo: { documentoId: doc } },
        { metodo: 'delete', rota: `/contratos/${id}/anexos/${anexo}` },
        { metodo: 'get', rota: `/contratos/${id}/pedidos` },
        { metodo: 'post', rota: `/contratos/${id}/pedidos`, corpo: { tipo: 'reajuste', titulo: 'Tentativa fictícia' } },
        { metodo: 'post', rota: `/contratos/${id}/itens`, corpo: itemCorpo },
        { metodo: 'post', rota: `/contratos/${id}/empenhos`, corpo: empenhoCorpo },
        { metodo: 'post', rota: `/empenhos/${ei}/etapa`, corpo: { etapa: 'transporte' } },
        { metodo: 'post', rota: `/empenho-itens/${eitem}/entregas`, corpo: { quantidade: '1', data: '2026-03-02' } },
        { metodo: 'post', rota: `/contratos/${id}/faturas`, corpo: faturaCorpo },
        { metodo: 'post', rota: `/faturas/${f}/pagamento`, corpo: { pagoEm: '2026-04-01', valorRecebido: '1' } },
        { metodo: 'post', rota: `/contratos/${id}/eventos`, corpo: { tipo: 'aditivo', data: '2026-03-01', descricao: 'Tentativa fictícia', novoValor: '99999' } },
        { metodo: 'post', rota: `/contratos/${id}/encerrar`, corpo: { status: 'encerrado' } },
      ];
      for (const c of casos) {
        await http()[c.metodo](`${raiz}${c.rota}`).set(bearer(invasor)).send(c.corpo ?? {}).expect(404);
        const url = `/empresas/${outra}${c.rota}`;
        const r = await http()[c.metodo](url).set(bearer(invasor)).send(c.corpo ?? {});
        if (c.metodo === 'get' && ['/contratos', '/contratos/pendentes-de-cadastro'].includes(c.rota)) {
          expect(r.status).toBe(200);
          expect(JSON.stringify(r.body)).not.toContain(id);
          for (const segredo of [ci, ei, eitem, f, doc, anexo, pendAc ?? '', '9876.5432', '12345.6789', '45678.9123']) expect(JSON.stringify(r.body)).not.toContain(segredo);
        } else {
          // Q-31b: pagamento/encerramento ainda usam 400 para ausência; compara com UUID inexistente.
          const rotaVazia = c.rota.replaceAll(id, ausente).replaceAll(anexo, ausente).replaceAll(ei, ausente).replaceAll(eitem, ausente).replaceAll(f, ausente);
          const corpoVazio = JSON.parse(JSON.stringify(c.corpo ?? {}).replaceAll(ac ?? '', ausente)) as object;
          const vazio = await http()[c.metodo](`/empresas/${outra}${rotaVazia}`).set(bearer(invasor)).send(corpoVazio);
          const esperado = c.metodo === 'get' && /\/(anexos|pedidos)$/.test(c.rota) ? 200
            : /\/(pagamento|encerrar)$/.test(c.rota) ? 400 : 404;
          expect(r.status, `${c.metodo} ${c.rota}: ${JSON.stringify(r.body)}`).toBe(esperado);
          expect(r.status).toBe(vazio.status);
          expect(r.body).toEqual(vazio.body);
          if (r.status === 200) expect(r.body).toEqual([]);
        }
        expect(await snapshot()).toEqual(antes);
      }
      // Um contrato próprio também não pode vincular o documento de outra empresa.
      const proprio = ((await http().post(`/empresas/${outra}/contratos`).set(bearer(invasor)).send({ ...novoContrato, numero: crypto.randomUUID() }).expect(201)).body as { id: string }).id;
      await http().post(`/empresas/${outra}/contratos/${proprio}/anexos`).set(bearer(invasor)).send({ documentoId: doc }).expect(404);
      expect(await snapshot()).toEqual(antes);
    });
  }

});
