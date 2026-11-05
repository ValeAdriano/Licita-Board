import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, lembrarMfa, stepUp, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Propostas da Fase 08: só de preço aprovado, fluxo com permissões, final imutável, download e A x B de cada endpoint.
describe('propostas: fluxo e A x B', () => {
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

  let empA: string; let empB: string; let a: string; let b: string; let editor: string; let leitor: string;
  let acomp: string; let prop: string; let v2: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Proposta A'); empB = await criarEmpresa('Proposta B');
    const [eA, eB, eE, eL] = await Promise.all([criarUsuario('pp-a'), criarUsuario('pp-b'), criarUsuario('pp-e'), criarUsuario('pp-l')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eE, empA, 'OPERADOR', ['propostas:visualizar', 'propostas:cadastrar', 'propostas:editar', 'agenda:visualizar']);
    await vincular(eL, empA, 'OPERADOR', ['propostas:visualizar', 'agenda:visualizar']);
    [a, b, editor, leitor] = await Promise.all([entrar(eA), entrar(eB), entrar(eE), entrar(eL)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Proposta', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    const edital = (await admin.query<{ id: string }>(
      `insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values ($1, $2, $3, '7/2026', 'Objeto', repeat('d', 64)) returning id`, [fonte, `PP-${crypto.randomUUID()}`, orgao])).rows[0]?.id;
    const item = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao, quantidade, valor_unitario_estimado) values ($1, 1, 'Veículo', 10, 200) returning id`, [edital])).rows[0]?.id;
    acomp = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empA, edital])).rows[0]?.id ?? '';
    const part = (await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values ($1, $2, $3) returning id`, [empA, acomp, item])).rows[0]?.id;
    await admin.query(`insert into priv.precificacoes (empresa_id, participacao_id, quantidade, calculado_em, preco_final_unit, total_proposta) values ($1, $2, 10, now(), 125, 1250)`, [empA, part]);
  });
  afterAll(async () => {
    await app.close();
  });

  it('sem preço aprovado não há proposta; com preço aprovado nasce o rascunho (sem custos) e o worker é enfileirado', async () => {
    await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/propostas`).set(bearer(a)).send({}).expect(400); // preço ainda não aprovado
    await admin.query(`update priv.precificacoes set aprovado_em = now(), aprovado_por = (select usuario_id from core.vinculos where empresa_id = $1 limit 1) where empresa_id = $1`, [empA]);
    const antes = Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'gerar_proposta'`)).rows[0]?.count);
    await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/propostas`).set(bearer(leitor)).send({}).expect(404); // só visualizar
    const r = await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/propostas`).set(bearer(editor)).send({ validadeDias: 60, prazoEntregaDias: 30, garantiaMeses: 12, condicoes: 'Pagamento em 30 dias', local: 'Curitiba' }).expect(201);
    prop = (r.body as { id: string }).id;
    expect(Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'gerar_proposta'`)).rows[0]?.count)).toBe(antes + 1);
    const d = (await http().get(`/empresas/${empA}/acompanhamentos/${acomp}/propostas`).set(bearer(leitor)).expect(200)).body as { propostas: { id: string; versao: number; status: string; total: string; conteudo: object[]; bloqueada: boolean }[] };
    expect(d.propostas.map((p) => [p.id, p.versao, p.status, p.total, p.bloqueada])).toEqual([[prop, 1, 'rascunho', '1250.0000', true]]);
    expect(JSON.stringify(d.propostas[0]?.conteudo)).not.toMatch(/custo|margem/i);
  });

  it('fluxo: conferir exige validação sem bloqueio; aprovar exige propostas/aprovar; devolver volta a rascunho', async () => {
    await http().post(`/empresas/${empA}/propostas/${prop}/conferir`).set(bearer(editor)).expect(400); // o worker ainda não validou
    await admin.query(`update priv.propostas set validada_em = now(), bloqueada = false where id = $1`, [prop]); // worker simulado
    await http().post(`/empresas/${empA}/propostas/${prop}/conferir`).set(bearer(leitor)).expect(404);
    await http().post(`/empresas/${empA}/propostas/${prop}/conferir`).set(bearer(editor)).expect(204);
    await http().post(`/empresas/${empA}/propostas/${prop}/aprovar`).set(bearer(editor)).expect(404); // editor sem propostas/aprovar
    await http().post(`/empresas/${empA}/propostas/${prop}/devolver`).set(bearer(editor)).expect(204);
    await http().post(`/empresas/${empA}/propostas/${prop}/aprovar`).set(bearer(a)).expect(400); // não está em conferência
    await http().post(`/empresas/${empA}/propostas/${prop}/conferir`).set(bearer(editor)).expect(204);
    await http().post(`/empresas/${empA}/propostas/${prop}/aprovar`).set(bearer(a)).expect(403); // sem a reautenticação (step-up) não aprova
    const su = await stepUp(app, a, 'proposta_final'); a = su.token;
    await http().post(`/empresas/${empA}/propostas/${prop}/aprovar`).set(bearer(a)).send({ stepUp: su.id }).expect(202);
    expect((await admin.query<{ status: string }>(`select status from priv.propostas where id = $1`, [prop])).rows[0]?.status).toBe('aprovada');
  });

  it('final é imutável e preservada; alterar = nova versão; download só do final e só de quem vê', async () => {
    await http().post(`/empresas/${empA}/propostas/${prop}/download`).set(bearer(a)).expect(404); // ainda não é final
    await admin.query(`update priv.propostas set status = 'final', arquivo_chave = 'propostas/teste/proposta-v1.docx', arquivo_sha256 = repeat('b', 64), gerado_em = now() where id = $1`, [prop]); // worker simulado
    await http().post(`/empresas/${empA}/propostas/${prop}/devolver`).set(bearer(editor)).expect(400); // final não volta
    await http().post(`/empresas/${empA}/propostas/${prop}/dados`).set(bearer(editor)).send({ validadeDias: 90 }).expect(404); // só rascunho se edita
    const nv = await http().post(`/empresas/${empA}/propostas/${prop}/nova-versao`).set(bearer(editor)).send({}).expect(201);
    v2 = (nv.body as { id: string }).id;
    const d = (await http().get(`/empresas/${empA}/acompanhamentos/${acomp}/propostas`).set(bearer(a)).expect(200)).body as { propostas: { id: string; versao: number; status: string; temArquivo: boolean }[] };
    expect(d.propostas.map((p) => [p.versao, p.status, p.temArquivo])).toEqual([[2, 'rascunho', false], [1, 'final', true]]);
    await http().post(`/empresas/${empA}/propostas/${v2}/dados`).set(bearer(editor)).send({ validadeDias: 90, prazoEntregaDias: 20, garantiaMeses: 24 }).expect(202);
    const dl = await http().post(`/empresas/${empA}/propostas/${prop}/download`).set(bearer(leitor));
    await http().post(`/empresas/${empA}/propostas/${prop}/download`).set(bearer(leitor)).send({ formato: 'pdf' }).expect(404); // final sem PDF ainda
    await http().post(`/empresas/${empA}/propostas/${prop}/download`).set(bearer(leitor)).send({ formato: 'odt' }).expect(400);
    const jobs = Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'gerar_proposta'`)).rows[0]?.count);
    await http().post(`/empresas/${empA}/propostas/${prop}/pdf`).set(bearer(leitor)).expect(202); // pedir o PDF enfileira o worker
    expect(Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'gerar_proposta'`)).rows[0]?.count)).toBe(jobs + 1);
    await http().post(`/empresas/${empA}/propostas/${v2}/pdf`).set(bearer(leitor)).expect(404); // rascunho não tem PDF
    expect([200, 503]).toContain(dl.status); // 503 quando o armazenamento de teste não está ligado; nunca 404 para quem vê
  });

  it('A x B: B não lê, não cria nem altera nada de A, nem baixa a final', async () => {
    await http().get(`/empresas/${empA}/acompanhamentos/${acomp}/propostas`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/propostas`).set(bearer(b)).send({}).expect(404);
    for (const acao of ['conferir', 'aprovar', 'devolver', 'validar', 'nova-versao', 'download', 'pdf']) {
      await http().post(`/empresas/${empA}/propostas/${v2}/${acao}`).set(bearer(b)).send({}).expect(404);
    }
    // empresa de B na rota com ids de A: o banco não encontra
    await http().get(`/empresas/${empB}/acompanhamentos/${acomp}/propostas`).set(bearer(b)).expect(200).then((r) => { expect((r.body as { propostas: unknown[] }).propostas).toHaveLength(0); });
    await http().post(`/empresas/${empB}/propostas/${prop}/download`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empB}/propostas/${v2}/aprovar`).set(bearer(b)).expect(400); // mesma resposta para id de A e id inexistente: nada é revelado
    await http().post(`/empresas/${empB}/acompanhamentos/${acomp}/propostas`).set(bearer(b)).send({}).expect(404);
  });
});
