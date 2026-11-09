import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, lembrarMfa, stepUp, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Formação de preços da Fase 07: custos como string decimal, sigilo (ver_custos_margens), alçada e A x B de cada endpoint.
describe('preços: fluxo, sigilo e A x B', () => {
  let app: INestApplication;
  const http = () => request.agent(servidor(app)).set('X-Forwarded-For', ipNovo());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  async function entrar(email: string): Promise<string> {
    const login = await http().post('/auth/login').send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
    const t0 = (login.body as { token: string }).token;
    const cad = await http().post('/auth/mfa/cadastrar').set(bearer(t0)).send({ senha: SENHA }).expect(200);
    const uri = (cad.body as { uri: string }).uri;
    const conf = await http().post('/auth/mfa/confirmar').set(bearer(t0)).send({ codigo: totpDaUri(uri) }).expect(200);
    await admin.query(`update core.fatores_mfa set verificado_em = now() - interval '2 days' where usuario_id = (select id from core.usuarios where email = $1)`, [email]);
    const token = (conf.body as { token: string }).token;
    lembrarMfa(token, email, uri);
    return token;
  }

  let empA: string; let empB: string; let a: string; let b: string; let semCustos: string; let editor: string;
  let part: string; let prec: string; let linha: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Preço A'); empB = await criarEmpresa('Preço B');
    const [eA, eB, eS, eE] = await Promise.all([criarUsuario('pr-a'), criarUsuario('pr-b'), criarUsuario('pr-s'), criarUsuario('pr-e')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eS, empA, 'OPERADOR', ['precos:visualizar', 'precos:editar', 'editais:visualizar', 'agenda:visualizar']);
    await vincular(eE, empA, 'OPERADOR', ['precos:visualizar', 'precos:editar', 'precos:ver_custos_margens', 'editais:visualizar', 'agenda:visualizar']);
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
    await http().post(`/empresas/${empA}/precificacoes/${prec}/aprovar`).set(bearer(a)).send({ justificativa: 'Cliente estratégico, margem aprovada pela diretoria' }).expect(403); // abaixo do mínimo exige step-up
    const su = await stepUp(app, a, 'preco_abaixo_minimo'); a = su.token;
    await http().post(`/empresas/${empA}/precificacoes/${prec}/aprovar`).set(bearer(a)).send({ justificativa: 'Cliente estratégico, margem aprovada pela diretoria', stepUp: su.id }).expect(204);
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

  it('histórico PNCP (7.5): busca, curingas escapados, estatística por unidade, sigilo da camada privada e coleta sob demanda (429 em 1h)', async () => {
    const origem = (await admin.query<{ edital_id: string; item_id: string; fonte_id: string }>(
      `select a.edital_id, p.item_id, e.fonte_id from priv.participacoes p join priv.acompanhamentos a on a.id = p.acompanhamento_id join pub.editais e on e.id = a.edital_id where p.id = $1`, [part])).rows[0];
    if (!origem) throw new Error('Participação de origem ausente');
    const tag = `NotebookPro${crypto.randomUUID().slice(0, 8)}`;
    await admin.query(`update pub.edital_itens set descricao = $2, unidade_medida = 'UN' where id = $1`, [origem.item_id, `${tag} 16GB SSD`]);
    const c1 = cnpjFicticio(); const c2 = cnpjFicticio(); const c3 = cnpjFicticio();
    await admin.query(
      `insert into pub.precos_historicos (
         fonte_id, id_externo, edital_id, edital_item_id, situacao, cancelado,
         fornecedor_tipo, fornecedor_cnpj, fornecedor_nome, marca, modelo,
         quantidade, unidade_medida, valor_unitario, valor_total, classificacao, data_resultado, hash_conteudo, link_origem
       ) values
       ($1, $4, $2, $3, 'homologado', false, 'pj', $7, 'Fornecedor Um', 'Dell', 'Lat', 10, 'UN', 100.0000, 1000.0000, 1, '2026-10-15T10:00:00Z', repeat('1', 64), 'https://pncp.gov.br/app/editais/1'),
       ($1, $5, $2, $3, 'homologado', false, 'pj', $8, 'Fornecedor Dois', 'Lenovo', 'Think', 10, 'UN', 200.0000, 2000.0000, 2, '2026-10-16T10:00:00Z', repeat('2', 64), 'https://pncp.gov.br/app/editais/2'),
       ($1, $6, $2, $3, 'cancelado', true, 'pj', $9, 'Fornecedor Três', 'HP', 'Pro', 10, 'UN', 50.0000, 500.0000, 3, '2026-10-17T10:00:00Z', repeat('3', 64), 'https://pncp.gov.br/app/editais/3')`,
      [origem.fonte_id, origem.edital_id, origem.item_id, `${tag}:r:1`, `${tag}:r:2`, `${tag}:r:3`, c1, c2, c3],
    );
    await admin.query(
      `update priv.precificacoes set custo_direto_unit = 85.5000, preco_final_unit = 115.0000, margem_liquida_pct = 18.2500 where id = $1`,
      [prec],
    );

    // Com ver_custos_margens (editor de A): estatística discreta (mediana inferior de [100, 200] = 100.0000) e camada privada preenchida
    const rEditor = (await http().get(`/empresas/${empA}/precos/historico`).query({ texto: tag }).set(bearer(editor)).expect(200)).body as {
      total: number;
      estatistica: { n: number; minimo: string; mediana: string; maximo: string; unidade: string } | null;
      itens: { valorUnitario: string; privado: { nossaOferta: string; nossoCustoUnitario: string; nossaMargem: string } | null }[];
    };
    expect(rEditor.total).toBe(2);
    expect(rEditor.estatistica).toEqual({ n: 2, minimo: '100.0000', mediana: '100.0000', maximo: '200.0000', unidade: 'UN' });
    expect(rEditor.itens[0]?.privado).toEqual({
      nossaOferta: '115.0000',
      nossaClassificacao: null,
      nossoCustoUnitario: '85.5000',
      nossaMargem: '18.2500',
    });

    // Sem ver_custos_margens (semCustos de A): vê os dados públicos, mas privado vem null
    const rSemCustos = (await http().get(`/empresas/${empA}/precos/historico`).query({ texto: tag }).set(bearer(semCustos)).expect(200)).body as {
      itens: { privado: unknown }[];
    };
    expect(rSemCustos.itens).toHaveLength(2);
    expect(rSemCustos.itens.every((i) => i.privado === null)).toBe(true);

    // Empresa B consultando o mesmo item público: vê o dado público, mas NUNCA vê a camada privada de A
    const rB = (await http().get(`/empresas/${empB}/precos/historico`).query({ texto: tag }).set(bearer(b)).expect(200)).body as {
      itens: { privado: unknown }[];
    };
    expect(rB.itens).toHaveLength(2);
    expect(rB.itens.every((i) => i.privado === null)).toBe(true);

    // Curinga % na busca é escapado e não casa tudo
    const rCuringa = (await http().get(`/empresas/${empA}/precos/historico`).query({ texto: '%%%' }).set(bearer(editor)).expect(200)).body as { total: number };
    expect(rCuringa.total).toBe(0);

    // Unidades mistas (UN + CX) devolvem estatistica = null
    await admin.query(
      `insert into pub.precos_historicos (
         fonte_id, id_externo, edital_id, edital_item_id, situacao, cancelado,
         fornecedor_tipo, fornecedor_nome, quantidade, unidade_medida, valor_unitario, hash_conteudo, link_origem
       ) values ($1, $4, $2, $3, 'homologado', false, 'pj', 'Fornecedor Caixa', 5, 'CX', 900.0000, repeat('4', 64), 'https://pncp.gov.br/app/editais/4')`,
      [origem.fonte_id, origem.edital_id, origem.item_id, `${tag}:r:4`],
    );
    const rMisto = (await http().get(`/empresas/${empA}/precos/historico`).query({ texto: tag }).set(bearer(editor)).expect(200)).body as {
      estatistica: unknown;
    };
    expect(rMisto.estatistica).toBeNull();

    // Sugestão para a participação de A funciona para A e devolve 404 para B
    const sug = (await http().get(`/empresas/${empA}/participacoes/${part}/historico-sugerido`).set(bearer(editor)).expect(200)).body as {
      itemId: string;
      resultadosDoItem: { fornecedorNome: string }[];
    };
    expect(sug.itemId).toBe(origem.item_id);
    expect(sug.resultadosDoItem.length).toBeGreaterThanOrEqual(2);
    await http().get(`/empresas/${empB}/participacoes/${part}/historico-sugerido`).set(bearer(b)).expect(404);

    // Solicitar coleta sob demanda: 202 na primeira, 429 dentro de 1 hora
    const col1 = await http().post(`/empresas/${empA}/editais/${origem.edital_id}/buscar-resultados`).set(bearer(editor)).expect(202);
    expect((col1.body as { jobId: string }).jobId).toMatch(/^[0-9a-f-]{36}$/);
    await http().post(`/empresas/${empA}/editais/${origem.edital_id}/buscar-resultados`).set(bearer(editor)).expect(429);
  });

  // Matriz completa das rotas :empresa; cada caso usa recursos novos da dona.
  for (const dona of ['A', 'B'] as const) {
    it(`isolamento por endpoint: precos de ${dona} intacta, sem jobs ou dados para invasor`, async () => {
      const empresa = dona === 'A' ? empA : empB;
      const outra = dona === 'A' ? empB : empA;
      const token = dona === 'A' ? a : b;
      const invasor = dona === 'A' ? b : a;
      const origem = (await admin.query<{ edital_id: string; item_id: string }>(
        `select a.edital_id, p.item_id from priv.participacoes p join priv.acompanhamentos a on a.id = p.acompanhamento_id where p.id = $1`, [part])).rows[0];
      if (!origem) throw new Error('Participação de origem ausente');
      const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) select fonte_id, $2, orgao_id, objeto, hash_conteudo from pub.editais where id = $1 returning id`, [origem.edital_id, crypto.randomUUID()])).rows[0]?.id ?? '';
      const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empresa, edital])).rows[0]?.id ?? '';
      const item = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao, quantidade, valor_unitario_estimado) values ($1, 1, 'Item matriz', 10, 200) returning id`, [edital])).rows[0]?.id ?? '';
      const id = (await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values ($1, $2, $3) returning id`, [empresa, ac, item])).rows[0]?.id ?? '';
      const get = async () => (await http().get(`/empresas/${empresa}/participacoes/${id}/preco`).set(bearer(token)).expect(200)).body as unknown;
      const preco = (await http().post(`/empresas/${empresa}/participacoes/${id}/preco`).set(bearer(token)).send({}).expect(201)).body as { id: string };
      const custo = { nome: `Custo reservado ${dona}`, tipo: 'aquisicao', categoria: 'custo', forma: 'por_unidade', valor: '9876.5432' };
      const li = (await http().post(`/empresas/${empresa}/precificacoes/${preco.id}/linhas`).set(bearer(token)).send(custo).expect(201)).body as { id: string };
      const positivo = (await get()) as { linhas: { valor: string }[]; precificacao: { quantidade: string } };
      expect(positivo.linhas[0]?.valor).toBe('9876.5432');
      expect(typeof positivo.precificacao.quantidade).toBe('string');
      const antes = await get();
      const jobs = (await admin.query("select id from ops.jobs where tipo = 'calcular_preco' order by id")).rows;
      const rotas: { metodo: 'get' | 'post' | 'delete'; path: string; corpo?: object }[] = [
        { metodo: 'get', path: `participacoes/${id}/preco` },
        { metodo: 'get', path: `participacoes/${id}/historico-sugerido` },
        { metodo: 'post', path: `participacoes/${id}/preco`, corpo: {} },
        { metodo: 'post', path: `precificacoes/${preco.id}/parametros`, corpo: { quantidade: '1', margemDesejada: '20', margemMinima: '10', casas: 2, arredondamento: 'half_up' } },
        { metodo: 'post', path: `precificacoes/${preco.id}/linhas`, corpo: custo },
        { metodo: 'delete', path: `preco-linhas/${li.id}` },
        { metodo: 'post', path: `preco-linhas/${li.id}/validar` },
        { metodo: 'post', path: `precificacoes/${preco.id}/aprovar`, corpo: {} },
      ];
      for (const rota of rotas) {
        for (const e of [empresa, outra]) {
          const r = await http()[rota.metodo](`/empresas/${e}/${rota.path}`).set(bearer(invasor)).send(rota.corpo ?? {}).expect(404);
          expect(r.body).toEqual({ message: 'Not Found', statusCode: 404 });
        }
      }
      expect(await get()).toEqual(antes);
      expect((await admin.query("select id from ops.jobs where tipo = 'calcular_preco' order by id")).rows).toEqual(jobs);
    });
  }

});
