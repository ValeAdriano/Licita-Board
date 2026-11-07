import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// A x B dos endpoints da Fase 03 (documentos, atestados) e da Fase 04 (oportunidades, edital, importação,
// pesquisa manual, cobertura): empresa B nunca lê nem mexe no que é de A; quem não tem editais/visualizar
// não lê o dado público; plataforma só para SUPERADMIN (AGENTS.md, regra 13).
describe('A x B: documentos, atestados e pesquisa de editais', () => {
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

  let empA: string; let empB: string; let empC: string;
  let a: string; let b: string; let semEditais: string; let sup: string;
  let docA: string; let versaoA: string; let opA: string; let editalId: string; let arquivoId: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Pesquisa A'); empB = await criarEmpresa('Pesquisa B'); empC = await criarEmpresa('Pesquisa C');
    const [eA, eB, eC, eS] = await Promise.all([criarUsuario('p-a'), criarUsuario('p-b'), criarUsuario('p-c'), criarUsuario('p-s')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eC, empC, 'OPERADOR', ['empresas:visualizar']); // sem editais nem documentos
    await admin.query('update core.usuarios set superadmin = true where email = $1', [eS]);
    [a, b, semEditais, sup] = await Promise.all([entrar(eA), entrar(eB), entrar(eC), entrar(eS)]);

    // Documento e versão liberada de A (o upload real precisa de S3; aqui só interessa o isolamento).
    const tipo = (await admin.query<{ id: string }>(`select id from pub.tipos_documento where slug = 'cnd_federal'`)).rows[0]?.id;
    docA = ((await http().post(`/empresas/${empA}/documentos`).set(bearer(a)).send({ tipoId: tipo, descricao: 'CND de A' }).expect(201)).body as { id: string }).id;
    versaoA = (await admin.query<{ id: string }>(
      `insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo, validade)
       values ($1, $2, 1, 'documentos/x', 'cnd.pdf', 'liberado', current_date + 90) returning id`, [docA, empA])).rows[0]?.id ?? '';

    // Dado público de licitação e a oportunidade de A.
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(
      `insert into pub.orgaos (cnpj, razao_social, uf) values ($1, 'Órgão do teste A x B', 'PR') returning id`, [cnpjFicticio()])).rows[0]?.id;
    editalId = (await admin.query<{ id: string }>(
      `insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo)
       values ($1, $2, $3, 'Aquisição de teste', repeat('c', 64)) returning id`, [fonte, `AXB-${crypto.randomUUID()}`, orgao])).rows[0]?.id ?? '';
    const item = (await admin.query<{ id: string }>(
      `insert into pub.edital_itens (edital_id, numero_item, descricao) values ($1, 1, 'Item de teste') returning id`, [editalId])).rows[0]?.id;
    arquivoId = (await admin.query<{ id: string }>(
      `insert into pub.edital_arquivos (edital_id, url_origem, status_arquivo, arquivo_chave, sha256)
       values ($1, 'https://pncp.gov.br/x', 'liberado', 'editais/x/y', repeat('d', 64)) returning id`, [editalId])).rows[0]?.id ?? '';
    opA = (await admin.query<{ id: string }>(
      `insert into priv.oportunidades (empresa_id, edital_id, item_id, nota, faixa, versao_regra, edital_versao)
       values ($1, $2, $3, 80, 'alta', 'teste', 1) returning id`, [empA, editalId, item])).rows[0]?.id ?? '';
  });
  afterAll(async () => {
    await app.close();
  });

  it('documentos: B e quem não tem a permissão não leem, baixam nem listam versões de A', async () => {
    expect((await http().get(`/empresas/${empA}/documentos`).set(bearer(a)).expect(200)).body).toHaveLength(1);
    await http().get(`/empresas/${empA}/documentos`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empA}/documentos/${docA}/versoes`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/versoes/${versaoA}/download`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empB}/documentos`).set(bearer(b)).expect(200).then((r) => { expect(r.body).toHaveLength(0); });
    // Usando a empresa de B na rota para tentar alcançar a versão de A: o banco não a encontra.
    await http().post(`/empresas/${empB}/versoes/${versaoA}/download`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empC}/documentos`).set(bearer(semEditais)).expect(404);
  });

  it('atestados: A x B', async () => {
    const unidade = (await admin.query<{ id: string }>(`select id from pub.unidades where simbolo = 'm'`)).rows[0]?.id;
    await http().post(`/empresas/${empA}/atestados`).set(bearer(a))
      .send({ documentoId: docA, contratante: 'Prefeitura A', objeto: 'Fornecimento', itens: [{ descricao: 'Item', quantidade: '10.5', unidadeId: unidade }] }).expect(201);
    expect((await http().get(`/empresas/${empA}/atestados`).set(bearer(a)).expect(200)).body).toHaveLength(1);
    await http().get(`/empresas/${empA}/atestados`).set(bearer(b)).expect(404);
    // B não pode ligar um atestado da empresa B ao documento de A (FK composta por empresa).
    await http().post(`/empresas/${empB}/atestados`).set(bearer(b))
      .send({ documentoId: docA, contratante: 'Intruso', objeto: 'x', itens: [{ descricao: 'Item', quantidade: '1', unidadeId: unidade }] }).expect((r) => { expect(r.status).toBeGreaterThanOrEqual(400); });
    expect((await http().get(`/empresas/${empB}/atestados`).set(bearer(b)).expect(200)).body).toHaveLength(0);
  });

  it('oportunidades: cada empresa só vê as suas e só A faz triagem das dela', async () => {
    const la = (await http().get(`/empresas/${empA}/oportunidades?encerradas=1`).set(bearer(a)).expect(200)).body as { itens: { id: string }[] };
    expect(la.itens.map((i) => i.id)).toEqual([opA]);
    await http().get(`/empresas/${empA}/oportunidades`).set(bearer(b)).expect(404);
    expect(((await http().get(`/empresas/${empB}/oportunidades?encerradas=1`).set(bearer(b)).expect(200)).body as { itens: unknown[] }).itens).toHaveLength(0);
    await http().post(`/empresas/${empA}/oportunidades/${opA}/triagem`).set(bearer(b)).send({ triagem: 'interesse' }).expect(404);
    await http().post(`/empresas/${empB}/oportunidades/${opA}/triagem`).set(bearer(b)).send({ triagem: 'interesse' }).expect(404); // não descobre nem a existência
    await http().post(`/empresas/${empA}/oportunidades/${opA}/triagem`).set(bearer(a)).send({ triagem: 'descartada_pelo_usuario' }).expect(400); // motivo obrigatório
    await http().post(`/empresas/${empA}/oportunidades/${opA}/triagem`).set(bearer(a)).send({ triagem: 'interesse' }).expect(204);
    expect((await admin.query('select triagem from priv.oportunidades where id = $1', [opA])).rows[0]).toEqual({ triagem: 'interesse' });
  });

  it('comparação de versões do edital: mostra o diff a quem tem editais/visualizar e recusa faixa inválida', async () => {
    const c1 = JSON.stringify({ campos: { objeto: 'Mesas', situacao: 'Divulgada' }, itens: [{ numero_item: 1, descricao: 'Mesa', quantidade: '10.0000' }], arquivos: [] });
    const c2 = JSON.stringify({ campos: { objeto: 'Mesas', situacao: 'Suspensa' }, itens: [{ numero_item: 1, descricao: 'Mesa', quantidade: '12.0000' }], arquivos: [] });
    await admin.query(`delete from pub.edital_versoes where edital_id = $1 and versao > 1`, [editalId]);
    await admin.query(`insert into pub.edital_versoes (edital_id, versao, hash_conteudo, campos_alterados, conteudo) values ($1, 1, repeat('a', 64), '{}', $2::jsonb) on conflict (edital_id, versao) do update set conteudo = excluded.conteudo`, [editalId, c1]);
    await admin.query(`insert into pub.edital_versoes (edital_id, versao, hash_conteudo, campos_alterados, conteudo) values ($1, 2, repeat('b', 64), '{situacao,itens}', $2::jsonb)`, [editalId, c2]);
    await admin.query(`update pub.editais set versao_atual = 2 where id = $1`, [editalId]);
    const r = (await http().get(`/editais/${editalId}/comparar`).set(bearer(a)).expect(200)).body as { de: number; para: number; campos: { campo: string }[]; itens: { tipo: string }[]; alteraProposta: boolean };
    expect([r.de, r.para, r.campos.map((c) => c.campo), r.itens.map((i) => i.tipo), r.alteraProposta]).toEqual([1, 2, ['situacao'], ['alterado'], true]);
    await http().get(`/editais/${editalId}/comparar?de=2&para=1`).set(bearer(a)).expect(400);
    await http().get(`/editais/${editalId}/comparar?de=1&para=9`).set(bearer(a)).expect(404);
    await http().get(`/editais/${editalId}/comparar`).set(bearer(semEditais)).expect(404);
  });

  it('edital público: só quem tem editais/visualizar em alguma empresa; download auditado', async () => {
    await http().get(`/editais/${editalId}`).set(bearer(a)).expect(200);
    await http().get(`/editais/${editalId}`).set(bearer(b)).expect(200); // dado público: qualquer empresa com editais/visualizar
    await http().get(`/editais/${editalId}`).set(bearer(semEditais)).expect(404);
    await http().get(`/editais/${editalId}/trechos?q=teste`).set(bearer(semEditais)).expect(200).then((r) => { expect(r.body).toHaveLength(0); });
    await http().post(`/editais/arquivos/${arquivoId}/download`).set(bearer(semEditais)).expect(403);
    // Com permissão o banco registra o download (a assinatura da URL falha só porque não há S3 no teste).
    const r = await http().post(`/editais/arquivos/${arquivoId}/download`).set(bearer(a));
    expect([200, 503]).toContain(r.status);
    expect((await admin.query('select count(*)::int as n from ops.edital_downloads where arquivo_id = $1', [arquivoId])).rows[0]).toEqual({ n: 1 });
  });

  it('importação e pesquisa manual: B não age pela empresa de A; host fora da lista é recusado', async () => {
    await admin.query(`update ops.fontes set ativa = true where slug = 'pncp'`);
    try {
      await http().post(`/empresas/${empA}/importacoes`).set(bearer(b)).send({ url: 'https://pncp.gov.br/app/editais/1/2026/1' }).expect(404);
      await http().post(`/empresas/${empA}/importacoes`).set(bearer(a)).send({ url: 'https://site-qualquer.example/edital.pdf' }).expect(400);
      await http().post(`/empresas/${empA}/importacoes`).set(bearer(a)).send({ url: 'https://pncp.gov.br/app/editais/11222333000181/2026/1' }).expect(202);
      await http().get(`/empresas/${empA}/importacoes`).set(bearer(b)).expect(404);
      expect(((await http().get(`/empresas/${empB}/importacoes`).set(bearer(b)).expect(200)).body as unknown[])).toHaveLength(0);
      await http().post(`/empresas/${empA}/pesquisas`).set(bearer(b)).send({ inicio: '2026-11-01', fim: '2026-11-02', uf: 'PR' }).expect(404);
      await http().post(`/empresas/${empA}/pesquisas`).set(bearer(a)).send({ inicio: '2026-01-01', fim: '2026-12-31' }).expect(400); // mais de 31 dias
    } finally {
      await admin.query(`update ops.fontes set ativa = false where slug = 'pncp'`);
    }
  });

  it('plataforma: cobertura, amostra e apuração só do SUPERADMIN; estado das fontes só com permissão', async () => {
    await http().get('/plataforma/pesquisa/cobertura').set(bearer(a)).expect(403);
    await http().post('/plataforma/pesquisa/amostra').set(bearer(a)).send({ mes: '2026-11-01', itens: [{ referencia: 'x-1', uf: 'PR' }] }).expect(403);
    await http().post('/plataforma/pesquisa/cobertura/apurar').set(bearer(a)).send({ mes: '2026-11-01' }).expect(403);
    const painel = (await http().get('/plataforma/pesquisa/cobertura').set(bearer(sup)).expect(200)).body as { amostraMedida: boolean };
    expect(painel.amostraMedida).toBe(false); // sem amostra: "não medida", nunca 100%
    await http().get('/pesquisa/estado').set(bearer(a)).expect(200);
    await http().get('/pesquisa/estado').set(bearer(semEditais)).expect(403);
  });
  // Todas as cinco rotas :empresa do PesquisaController, nos dois sentidos.
  for (const dona of ['A', 'B'] as const) {
    it(`isolamento por endpoint: pesquisa de ${dona} preservada contra a outra empresa`, async () => {
      const empresa = dona === 'A' ? empA : empB;
      const outra = dona === 'A' ? empB : empA;
      const token = dona === 'A' ? a : b;
      const invasor = dona === 'A' ? b : a;
      const item = (await admin.query<{ item_id: string }>('select item_id from priv.oportunidades where id = $1', [opA])).rows[0]?.item_id;
      const op = dona === 'A' ? opA : (await admin.query<{ id: string }>(
        `insert into priv.oportunidades (empresa_id, edital_id, item_id, nota, faixa, versao_regra, edital_versao)
         values ($1, $2, $3, 73, 'media', 'teste', 1) returning id`, [empresa, editalId, item])).rows[0]?.id ?? '';
      const get = async (e: string, t: string, path: string) =>
        (await http().get(`/empresas/${e}/${path}`).set(bearer(t)).expect(200)).body as unknown;
      await admin.query(`update ops.fontes set ativa = true where slug = 'pncp'`);
      try {
        // Controles positivos: os corpos são aceitos para a dona, sem rede externa.
        const importacao = { url: `https://pncp.gov.br/app/editais/11222333000181/2026/${dona === 'A' ? '23' : '24'}` };
        const pesquisa = { inicio: '2026-11-01', fim: '2026-11-02', uf: 'PR' };
        const criada = (await http().post(`/empresas/${empresa}/importacoes`).set(bearer(token)).send(importacao).expect(202)).body as { importacaoId: string };
        await http().post(`/empresas/${empresa}/pesquisas`).set(bearer(token)).send(pesquisa).expect(202);
        const antes = await get(empresa, token, 'oportunidades?encerradas=1');
        const importacoes = await get(empresa, token, 'importacoes');
        const execucoes = (await admin.query('select id from ops.execucoes order by id')).rows;
        const jobs = (await admin.query('select id from ops.jobs order by id')).rows;
        const rotas: { metodo: 'get' | 'post'; path: string; corpo?: object; recurso?: boolean }[] = [
          { metodo: 'get', path: 'oportunidades?encerradas=1' },
          { metodo: 'post', path: `oportunidades/${op}/triagem`, corpo: { triagem: 'descartada_pelo_usuario', motivo: 'Tentativa fictícia de invasão' }, recurso: true },
          { metodo: 'post', path: 'pesquisas', corpo: pesquisa },
          { metodo: 'post', path: 'importacoes', corpo: importacao },
          { metodo: 'get', path: 'importacoes' },
        ];
        for (const rota of rotas) {
          await http()[rota.metodo](`/empresas/${empresa}/${rota.path}`).set(bearer(invasor)).send(rota.corpo ?? {}).expect(404);
          if (rota.recurso) await http()[rota.metodo](`/empresas/${outra}/${rota.path}`).set(bearer(invasor)).send(rota.corpo ?? {}).expect(404);
        }
        expect(await get(empresa, token, 'oportunidades?encerradas=1')).toEqual(antes);
        expect(await get(empresa, token, 'importacoes')).toEqual(importacoes);
        expect((await admin.query('select id from ops.execucoes order by id')).rows).toEqual(execucoes);
        expect((await admin.query('select id from ops.jobs order by id')).rows).toEqual(jobs);
        expect(JSON.stringify(await get(outra, invasor, 'oportunidades?encerradas=1'))).not.toContain(op);
        expect(JSON.stringify(await get(outra, invasor, 'importacoes'))).not.toContain(criada.importacaoId);
      } finally {
        await admin.query(`update ops.fontes set ativa = false where slug = 'pncp'`);
      }
    });
  }

});
