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

  it('remover requisito: só quem edita; some da matriz', async () => {
    await http().delete(`/empresas/${empA}/requisitos/${requisito}`).set(bearer(leitor)).expect(404);
    await http().delete(`/empresas/${empA}/requisitos/${requisito}`).set(bearer(editor)).expect(204);
    const d = (await http().get(`/empresas/${empA}/participacoes/${part}/analise`).set(bearer(a)).expect(200)).body as { requisitos: unknown[]; analises: { linhas: unknown[] }[] };
    expect(d.requisitos).toHaveLength(0);
    expect(d.analises[0]?.linhas).toHaveLength(0); // a linha do requisito removido não aparece
  });
});
