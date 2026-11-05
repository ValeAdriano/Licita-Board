import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Formação de preços da Fase 07: custos como string decimal, sigilo (ver_custos_margens), alçada e A x B de cada endpoint.
describe('preços: fluxo, sigilo e A x B', () => {
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

  let empA: string; let empB: string; let a: string; let b: string; let semCustos: string; let editor: string;
  let part: string; let prec: string; let linha: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Preço A'); empB = await criarEmpresa('Preço B');
    const [eA, eB, eS, eE] = await Promise.all([criarUsuario('pr-a'), criarUsuario('pr-b'), criarUsuario('pr-s'), criarUsuario('pr-e')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eS, empA, 'OPERADOR', ['precos:visualizar', 'precos:editar', 'agenda:visualizar']);
    await vincular(eE, empA, 'OPERADOR', ['precos:visualizar', 'precos:editar', 'precos:ver_custos_margens', 'agenda:visualizar']);
    [a, b, semCustos, editor] = await Promise.all([entrar(eA), entrar(eB), entrar(eS), entrar(eE)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Preço', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    const edital = (await admin.query<{ id: string }>(
      `insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) values ($1, $2, $3, 'Objeto', repeat('c', 64)) returning id`, [fonte, `PR-${crypto.randomUUID()}`, orgao])).rows[0]?.id;
    const item = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao, quantidade, valor_unitario_estimado) values ($1, 1, 'Veículo', 10, 200) returning id`, [edital])).rows[0]?.id;
    const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empA, edital])).rows[0]?.id;
    part = (await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values ($1, $2, $3) returning id`, [empA, ac, item])).rows[0]?.id ?? '';
  });
  afterAll(async () => {
    await app.close();
  });

  it('cria a precificação (quantidade e estimado vêm do item), recusa number e valores fora do limite', async () => {
    await http().post(`/empresas/${empA}/participacoes/${part}/preco`).set(bearer(a)).send({ quantidade: 5 }).expect(400); // number não é aceito
    const antes = Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'calcular_preco'`)).rows[0]?.count);
    const r = await http().post(`/empresas/${empA}/participacoes/${part}/preco`).set(bearer(editor)).send({}).expect(201);
    prec = (r.body as { id: string }).id;
    expect(Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'calcular_preco'`)).rows[0]?.count)).toBe(antes + 1);
    const d = (await http().get(`/empresas/${empA}/participacoes/${part}/preco`).set(bearer(a)).expect(200)).body as { precificacao: { id: string; quantidade: string; valorEstimadoUnit: string }; item: { valorUnitarioEstimado: string } };
    expect([d.precificacao.id, d.precificacao.quantidade, d.precificacao.valorEstimadoUnit]).toEqual([prec, '10.0000', '200.0000']);
    expect(d.item.valorUnitarioEstimado).toBe('200.0000');
    await http().post(`/empresas/${empA}/precificacoes/${prec}/parametros`).set(bearer(a)).send({ quantidade: '10', margemDesejada: '100', margemMinima: '10', casas: 2, arredondamento: 'half_up' }).expect(400); // 100% de margem
    await http().post(`/empresas/${empA}/precificacoes/${prec}/parametros`).set(bearer(a)).send({ quantidade: '10', margemDesejada: '20', margemMinima: '10', casas: 7, arredondamento: 'half_up' }).expect(400); // casas
  });

  it('linhas de custo e parâmetros por função; o worker é enfileirado e a API não devolve resultado inventado', async () => {
    await http().post(`/empresas/${empA}/precificacoes/${prec}/linhas`).set(bearer(editor)).send({ nome: 'Aquisição', tipo: 'aquisicao', categoria: 'custo', forma: 'por_unidade', valor: '100' }).expect(201);
    const l = await http().post(`/empresas/${empA}/precificacoes/${prec}/linhas`).set(bearer(editor)).send({ nome: 'ICMS (teste)', tipo: 'tributo', categoria: 'percentual', percentual: '12' }).expect(201);
    linha = (l.body as { id: string }).id;
    await http().post(`/empresas/${empA}/precificacoes/${prec}/linhas`).set(bearer(editor)).send({ nome: 'Mista', tipo: 'frete', categoria: 'custo', forma: 'por_unidade', valor: '1', percentual: '5' }).expect(400);
    await http().post(`/empresas/${empA}/precificacoes/${prec}/parametros`).set(bearer(editor)).send({ quantidade: '10', margemDesejada: '20', margemMinima: '10', casas: 2, arredondamento: 'half_up', limiteInexequivel: '70' }).expect(202);
    const d = (await http().get(`/empresas/${empA}/participacoes/${part}/preco`).set(bearer(editor)).expect(200)).body as { precificacao: { precoFinalUnit: string | null; margemDesejada: string }; linhas: { id: string; validadoEm: string | null }[] };
    expect(d.precificacao.precoFinalUnit).toBeNull(); // quem calcula é o worker, não a API
    expect(d.precificacao.margemDesejada).toBe('20.0000');
    expect(d.linhas).toHaveLength(2);
  });

  it('sigilo: sem ver_custos_margens nada é lido (404 no guard), mas edição por função segue com permissão de editar', async () => {
    await http().get(`/empresas/${empA}/participacoes/${part}/preco`).set(bearer(semCustos)).expect(404);
    await http().post(`/empresas/${empA}/precificacoes/${prec}/linhas`).set(bearer(semCustos)).send({ nome: 'Frete', tipo: 'frete', categoria: 'custo', forma: 'total_lote', valor: '10' }).expect(201);
  });

  it('alçada: aprovar exige precos/aprovar, resultado sem erro e justificativa abaixo do mínimo', async () => {
    await http().post(`/empresas/${empA}/precificacoes/${prec}/aprovar`).set(bearer(editor)).send({}).expect(404); // editor sem aprovar
    await http().post(`/empresas/${empA}/precificacoes/${prec}/aprovar`).set(bearer(a)).send({}).expect(400); // ainda não calculado
    // simula o worker (a API não calcula): resultado abaixo do mínimo
    await admin.query(`update priv.precificacoes set calculado_em = now(), abaixo_do_minimo = true, erro_calculo = null where id = $1`, [prec]);
    await http().post(`/empresas/${empA}/precificacoes/${prec}/aprovar`).set(bearer(a)).send({ justificativa: 'curta' }).expect(400);
    await http().post(`/empresas/${empA}/precificacoes/${prec}/aprovar`).set(bearer(a)).send({ justificativa: 'Cliente estratégico, margem aprovada pela diretoria' }).expect(204);
    await http().post(`/empresas/${empA}/preco-linhas/${linha}/validar`).set(bearer(editor)).expect(404);
    await http().post(`/empresas/${empA}/preco-linhas/${linha}/validar`).set(bearer(a)).expect(204); // 🧾 validação do responsável
    const d = (await http().get(`/empresas/${empA}/participacoes/${part}/preco`).set(bearer(a)).expect(200)).body as { precificacao: { aprovadoEm: string | null }; linhas: { id: string; validadoEm: string | null }[] };
    expect(d.precificacao.aprovadoEm).not.toBeNull();
    expect(d.linhas.find((x) => x.id === linha)?.validadoEm).not.toBeNull();
    await http().delete(`/empresas/${empA}/preco-linhas/${linha}`).set(bearer(editor)).expect(204); // mudar insumo derruba a aprovação
    expect(((await http().get(`/empresas/${empA}/participacoes/${part}/preco`).set(bearer(a)).expect(200)).body as { precificacao: { aprovadoEm: string | null } }).precificacao.aprovadoEm).toBeNull();
  });

  it('A x B: B não lê custos nem altera nada de A, nem descobre ids', async () => {
    await http().get(`/empresas/${empA}/participacoes/${part}/preco`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/participacoes/${part}/preco`).set(bearer(b)).send({}).expect(404);
    await http().post(`/empresas/${empA}/precificacoes/${prec}/parametros`).set(bearer(b)).send({ quantidade: '1', margemDesejada: '1', margemMinima: '1', casas: 2, arredondamento: 'half_up' }).expect(404);
    await http().post(`/empresas/${empA}/precificacoes/${prec}/linhas`).set(bearer(b)).send({ nome: 'Invasor', tipo: 'outro', categoria: 'custo', forma: 'por_unidade', valor: '1' }).expect(404);
    await http().post(`/empresas/${empA}/precificacoes/${prec}/aprovar`).set(bearer(b)).send({}).expect(404);
    // empresa de B na rota com ids de A: o banco não encontra
    await http().get(`/empresas/${empB}/participacoes/${part}/preco`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empB}/precificacoes/${prec}/linhas`).set(bearer(b)).send({ nome: 'Invasor', tipo: 'outro', categoria: 'custo', forma: 'por_unidade', valor: '1' }).expect(404);
    await http().post(`/empresas/${empB}/precificacoes/${prec}/aprovar`).set(bearer(b)).send({}).expect(404);
    await http().delete(`/empresas/${empB}/preco-linhas/${linha}`).set(bearer(b)).expect(404);
  });
});
