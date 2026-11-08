import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Análise técnica da Fase 06: requisitos, pedido de análise, conferência da ficha, aprovação e A x B de cada endpoint.
describe('análise técnica: fluxo e A x B', () => {
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

  let empA: string; let empB: string; let a: string; let b: string; let leitor: string; let editor: string;
  let part: string; let produto: string; let requisito: string; let analise: string; let linha: string; let documento: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Análise A'); empB = await criarEmpresa('Análise B');
    const [eA, eB, eL, eE] = await Promise.all([criarUsuario('an-a'), criarUsuario('an-b'), criarUsuario('an-l'), criarUsuario('an-e')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eL, empA, 'OPERADOR', ['analises:visualizar', 'agenda:visualizar']);
    await vincular(eE, empA, 'OPERADOR', ['analises:visualizar', 'analises:editar', 'agenda:visualizar']);
    [a, b, leitor, editor] = await Promise.all([entrar(eA), entrar(eB), entrar(eL), entrar(eE)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Análise', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    const edital = (await admin.query<{ id: string }>(
      `insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) values ($1, $2, $3, 'Objeto', repeat('f', 64)) returning id`, [fonte, `AN-${crypto.randomUUID()}`, orgao])).rows[0]?.id;
    const item = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao) values ($1, 1, 'Veículo') returning id`, [edital])).rows[0]?.id;
    const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empA, edital])).rows[0]?.id;
    part = (await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values ($1, $2, $3) returning id`, [empA, ac, item])).rows[0]?.id ?? '';
    produto = (await admin.query<{ id: string }>(
      `insert into priv.produtos (empresa_id, categoria_id, codigo_interno, descricao) values ($1, (select id from pub.categorias where slug = 'veiculos'), 'P-AN', 'Produto de teste') returning id`, [empA])).rows[0]?.id ?? '';
    documento = (await admin.query<{ id: string }>(
      `insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, (select id from pub.tipos_documento limit 1), 'Ficha técnica') returning id`, [empA])).rows[0]?.id ?? '';
  });
  afterAll(async () => {
    await app.close();
  });

  it('cria requisito (valor como string), valida o corpo e o worker é enfileirado só quando já há análise', async () => {
    const kw = (await admin.query<{ id: string }>(`select id from pub.unidades where simbolo = 'kW'`)).rows[0]?.id;
    await http().post(`/empresas/${empA}/participacoes/${part}/requisitos`).set(bearer(a)).send({ nome: 'Potência', operador: '>=', valorNumero: 100 }).expect(400); // number não é aceito
    await http().post(`/empresas/${empA}/participacoes/${part}/requisitos`).set(bearer(a)).send({ nome: 'Potência', operador: '>=' }).expect(400); // operador numérico sem valor
    const r = await http().post(`/empresas/${empA}/participacoes/${part}/requisitos`).set(bearer(a))
      .send({ nome: 'Potência mínima', tipo: 'minimo', operador: '>=', valorNumero: '100.5', unidadeId: kw, citacaoEdital: 'potência mínima de 100,5 kW', pagina: 4 }).expect(201);
    requisito = (r.body as { id: string }).id;
    const d = (await http().get(`/empresas/${empA}/participacoes/${part}/analise`).set(bearer(a)).expect(200)).body as { requisitos: { id: string; valorNumero: string }[]; produtos: { id: string }[]; atributos: unknown[]; unidades: unknown[] };
    expect(d.requisitos.map((x) => [x.id, x.valorNumero])).toEqual([[requisito, '100.500000000000']]);
    expect(d.produtos.map((x) => x.id)).toEqual([produto]); // A é admin: enxerga o catálogo da empresa
  });

  it('pedir análise exige produto da própria empresa e enfileira o worker; leitor não pede', async () => {
    await http().post(`/empresas/${empA}/participacoes/${part}/analises`).set(bearer(leitor)).send({ produtoId: produto }).expect(404);
    await http().post(`/empresas/${empA}/participacoes/${part}/analises`).set(bearer(a)).send({ produtoId: crypto.randomUUID() }).expect(404);
    const antes = Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'analisar_item'`)).rows[0]?.count);
    const r = await http().post(`/empresas/${empA}/participacoes/${part}/analises`).set(bearer(editor)).send({ produtoId: produto }).expect(202);
    analise = (r.body as { id: string }).id;
    expect(Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'analisar_item'`)).rows[0]?.count)).toBe(antes + 1);
    // simula o worker (a API não classifica): uma linha A CONFIRMAR e o resumo
    linha = (await admin.query<{ id: string }>(`insert into priv.analise_linhas (empresa_id, analise_id, requisito_id, resultado) values ($1, $2, $3, 'A CONFIRMAR') returning id`, [empA, analise, requisito])).rows[0]?.id ?? '';
    await admin.query(`update priv.analises_item set resumo = 'PENDENTE', calculado_em = now() where id = $1`, [analise]);
    const d = (await http().get(`/empresas/${empA}/participacoes/${part}/analise`).set(bearer(leitor)).expect(200)).body as { analises: { id: string; resumo: string; linhas: { resultado: string }[] }[] };
    expect(d.analises.map((x) => [x.id, x.resumo, x.linhas.map((l) => l.resultado)])).toEqual([[analise, 'PENDENTE', ['A CONFIRMAR']]]);
  });

  it('conferir a ficha exige documento, página e trecho e não muda a classificação; aprovar só sem pendência e só com analises/aprovar', async () => {
    await http().post(`/empresas/${empA}/analise-linhas/${linha}/ficha`).set(bearer(editor)).send({ documentoId: documento, pagina: 2 }).expect(400);
    await http().post(`/empresas/${empA}/analise-linhas/${linha}/ficha`).set(bearer(leitor)).send({ documentoId: documento, pagina: 2, trecho: 'Potência máxima 105 kW' }).expect(404);
    await http().post(`/empresas/${empA}/analise-linhas/${linha}/ficha`).set(bearer(editor)).send({ documentoId: documento, pagina: 2, trecho: 'Potência máxima 105 kW' }).expect(202);
    const l = (await admin.query<{ resultado: string; ficha_pagina: number; conferida: boolean }>(`select resultado, ficha_pagina, ficha_conferida_por is not null as conferida from priv.analise_linhas where id = $1`, [linha])).rows[0];
    expect(l).toEqual({ resultado: 'A CONFIRMAR', ficha_pagina: 2, conferida: true }); // quem classifica é o worker
    await http().post(`/empresas/${empA}/analises/${analise}/aprovar`).set(bearer(editor)).expect(404); // editor sem analises/aprovar
    await http().post(`/empresas/${empA}/analises/${analise}/aprovar`).set(bearer(a)).expect(400); // PENDENTE não se aprova
    await admin.query(`update priv.analises_item set resumo = 'COMPATÍVEL' where id = $1`, [analise]);
    await http().post(`/empresas/${empA}/analises/${analise}/aprovar`).set(bearer(a)).expect(204);
    expect((await admin.query<{ aprovado_resumo: string; ok: boolean }>(`select aprovado_resumo, aprovado_por is not null as ok from priv.analises_item where id = $1`, [analise])).rows[0]).toEqual({ aprovado_resumo: 'COMPATÍVEL', ok: true });
  });

  it('A x B: B não lê nem altera a análise de A, nem descobre ids', async () => {
    await http().get(`/empresas/${empA}/participacoes/${part}/analise`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/participacoes/${part}/requisitos`).set(bearer(b)).send({ nome: 'Invasor', operador: 'sim' }).expect(404);
    await http().delete(`/empresas/${empA}/requisitos/${requisito}`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/participacoes/${part}/analises`).set(bearer(b)).send({ produtoId: produto }).expect(404);
    await http().post(`/empresas/${empA}/analise-linhas/${linha}/ficha`).set(bearer(b)).send({ documentoId: documento, pagina: 1, trecho: 'xxxxxx' }).expect(404);
    await http().post(`/empresas/${empA}/analises/${analise}/aprovar`).set(bearer(b)).expect(404);
    // usando a empresa de B na rota com ids de A: o banco não encontra (404), sem revelar que existem
    await http().get(`/empresas/${empB}/participacoes/${part}/analise`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empB}/participacoes/${part}/requisitos`).set(bearer(b)).send({ nome: 'Invasor', operador: 'sim' }).expect(404);
    await http().post(`/empresas/${empB}/analises/${analise}/aprovar`).set(bearer(b)).expect(404);
  });

  it('extração por IA: só enfileira o worker (a API não chama a IA), limite diário, e a sugestão só vale depois de confirmada', async () => {
    await http().post(`/empresas/${empA}/participacoes/${part}/extrair-requisitos`).set(bearer(leitor)).expect(404);
    const jobs = Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'extrair_requisitos'`)).rows[0]?.count);
    await http().post(`/empresas/${empA}/participacoes/${part}/extrair-requisitos`).set(bearer(editor)).expect(202);
    expect(Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'extrair_requisitos'`)).rows[0]?.count)).toBe(jobs + 1);
    await http().post(`/empresas/${empA}/participacoes/${part}/extrair-requisitos`).set(bearer(editor)).expect(400); // já há uma em andamento
    await admin.query(`update priv.extracoes_ia set status = 'concluida' where participacao_id = $1`, [part]); // worker simulado
    await admin.query(`insert into priv.extracoes_ia (empresa_id, participacao_id, status) select $1, $2, 'concluida' from generate_series(1, 4)`, [empA, part]);
    await http().post(`/empresas/${empA}/participacoes/${part}/extrair-requisitos`).set(bearer(editor)).expect(429); // controle de custo
    // sugestão da IA (worker simulado): nasce não confirmada; confirmar exige analises/editar
    const sug = (await admin.query<{ id: string }>(`insert into priv.requisitos_item (empresa_id, participacao_id, nome, operador, valor_numero, origem, modelo_ia, prompt_versao) values ($1, $2, 'Sugestão da IA', '>=', 10, 'ia', 'modelo-x', 'req-v1') returning id`, [empA, part])).rows[0]?.id ?? '';
    const d = (await http().get(`/empresas/${empA}/participacoes/${part}/analise`).set(bearer(leitor)).expect(200)).body as { requisitos: { id: string; origem: string; confirmado: boolean }[]; extracoes: { status: string }[] };
    expect(d.requisitos.find((x) => x.id === sug)).toMatchObject({ origem: 'ia', confirmado: false });
    expect(d.extracoes.length).toBe(5);
    await http().post(`/empresas/${empA}/requisitos/${sug}/confirmar`).set(bearer(leitor)).expect(404);
    await http().post(`/empresas/${empB}/requisitos/${sug}/confirmar`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/requisitos/${sug}/confirmar`).set(bearer(editor)).expect(204);
    await http().post(`/empresas/${empA}/requisitos/${sug}/confirmar`).set(bearer(editor)).expect(400); // já confirmado (estado, 22023; Q-35)
    await http().post(`/empresas/${empA}/participacoes/${part}/extrair-requisitos`).set(bearer(b)).expect(404);
    await admin.query(`delete from priv.requisitos_item where id = $1`, [sug]);
  });

  it('remover requisito: só quem edita; some da matriz', async () => {
    await http().delete(`/empresas/${empA}/requisitos/${requisito}`).set(bearer(leitor)).expect(404);
    await http().delete(`/empresas/${empA}/requisitos/${requisito}`).set(bearer(editor)).expect(204);
    const d = (await http().get(`/empresas/${empA}/participacoes/${part}/analise`).set(bearer(a)).expect(200)).body as { requisitos: unknown[]; analises: { linhas: unknown[] }[] };
    expect(d.requisitos).toHaveLength(0);
    expect(d.analises[0]?.linhas).toHaveLength(0); // a linha do requisito removido não aparece
  });

  // Matriz completa das rotas :empresa; cada caso usa recursos novos da dona.
  for (const dona of ['A', 'B'] as const) {
    it(`isolamento por endpoint: analises de ${dona} intacta, sem jobs ou dados para invasor`, async () => {
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
      const get = async () => (await http().get(`/empresas/${empresa}/participacoes/${id}/analise`).set(bearer(token)).expect(200)).body as unknown;
      const pr = (await admin.query<{ id: string }>(`insert into priv.produtos (empresa_id, categoria_id, codigo_interno, descricao) values ($1, (select id from pub.categorias where slug = 'veiculos'), $2, 'Produto matriz') returning id`, [empresa, `AXB-${dona}`])).rows[0]?.id ?? '';
      const doc = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, (select id from pub.tipos_documento limit 1), 'Ficha matriz') returning id`, [empresa])).rows[0]?.id ?? '';
      const req = (await http().post(`/empresas/${empresa}/participacoes/${id}/requisitos`).set(bearer(token)).send({ nome: 'Requisito matriz', operador: 'sim' }).expect(201)).body as { id: string };
      const an = (await http().post(`/empresas/${empresa}/participacoes/${id}/analises`).set(bearer(token)).send({ produtoId: pr }).expect(202)).body as { id: string };
      const li = (await admin.query<{ id: string }>(`insert into priv.analise_linhas (empresa_id, analise_id, requisito_id, resultado) values ($1, $2, $3, 'A CONFIRMAR') returning id`, [empresa, an.id, req.id])).rows[0]?.id ?? '';
      await admin.query(`update priv.requisitos_item set origem = 'ia', modelo_ia = 'teste', prompt_versao = 'req-v1', confirmado_em = null, confirmado_por = null where id = $1`, [req.id]);
      const antes = await get();
      const jobs = (await admin.query("select id from ops.jobs where tipo in ('analisar_item', 'extrair_requisitos') order by id")).rows;
      const rotas: { metodo: 'get' | 'post' | 'delete'; path: string; corpo?: object }[] = [
        { metodo: 'get', path: `participacoes/${id}/analise` },
        { metodo: 'post', path: `participacoes/${id}/requisitos`, corpo: { nome: 'Intruso', operador: 'sim' } },
        { metodo: 'delete', path: `requisitos/${req.id}` },
        { metodo: 'post', path: `requisitos/${req.id}/confirmar` },
        { metodo: 'post', path: `participacoes/${id}/analises`, corpo: { produtoId: pr } },
        { metodo: 'post', path: `participacoes/${id}/extrair-requisitos` },
        { metodo: 'post', path: `analise-linhas/${li}/ficha`, corpo: { documentoId: doc, pagina: 1, trecho: 'Ficha técnica fictícia' } },
        { metodo: 'post', path: `analises/${an.id}/aprovar` },
      ];
      for (const rota of rotas) {
        for (const e of [empresa, outra]) {
          const r = await http()[rota.metodo](`/empresas/${e}/${rota.path}`).set(bearer(invasor)).send(rota.corpo ?? {}).expect(404);
          expect(r.body).toEqual({ message: 'Not Found', statusCode: 404 });
        }
      }
      expect(await get()).toEqual(antes);
      expect((await admin.query("select id from ops.jobs where tipo in ('analisar_item', 'extrair_requisitos') order by id")).rows).toEqual(jobs);
    });
  }

});
