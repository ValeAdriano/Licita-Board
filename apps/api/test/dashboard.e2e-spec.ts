import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Dashboard e relatórios da Fase 12: indicadores iguais aos registros, só o autorizado aparece, CSV e A x B.
describe('dashboard: indicadores, permissões e A x B', () => {
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

  let empA: string; let empB: string; let a: string; let b: string; let limitado: string; let semExportar: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Dash A'); empB = await criarEmpresa('Dash B');
    const [eA, eB, eL, eS] = await Promise.all([criarUsuario('da-a'), criarUsuario('da-b'), criarUsuario('da-l'), criarUsuario('da-s')]);
    await vincular(eS, empA, 'OPERADOR', ['agenda:visualizar']);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eL, empA, 'OPERADOR', ['agenda:visualizar', 'agenda:exportar']); // sem contratos, financeiro, documentos, propostas
    [a, b, limitado, semExportar] = await Promise.all([entrar(eA), entrar(eB), entrar(eL), entrar(eS)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Dash', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values ($1, $2, $3, '8/2026', 'Objeto', repeat('2', 64)) returning id`, [fonte, `DB-${crypto.randomUUID()}`, orgao])).rows[0]?.id;
    const itens = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao) select $1, n, 'Item ' || n from generate_series(1, 3) n returning id`, [edital])).rows.map((r) => r.id);
    const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id, data_abertura) values ($1, $2, now() + interval '10 days') returning id`, [empA, edital])).rows[0]?.id;
    const parts: string[] = [];
    for (const [i, it] of itens.entries()) parts.push((await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id, status, marca, modelo) values ($1, $2, $3, 'em_disputa', 'Marca ${String(i % 2)}', 'Mod') returning id`, [empA, ac, it])).rows[0]?.id ?? '');
    await admin.query(`insert into priv.resultados_item (empresa_id, participacao_id, resultado_final, valor_final) values ($1, $2, 'homologada', 1000.50), ($1, $3, 'perdida', 2000)`, [empA, parts[0], parts[1]]);
    await admin.query(`insert into priv.resultados_item (empresa_id, participacao_id, resultado_final, valor_final, motivo_perda) values ($1, $2, 'inabilitada', 500, 'Atestado incompatível')`, [empA, parts[2]]);
    const ct = (await admin.query<{ id: string }>(`insert into priv.contratos (empresa_id, numero, orgao, objeto, vigencia_inicio, vigencia_fim, valor_total) values ($1, 'C1', 'Órgão', 'Obj', '2026-01-01', '2030-12-31', 5000) returning id`, [empA])).rows[0]?.id;
    await admin.query(`insert into priv.empenhos (empresa_id, contrato_id, numero, emitido_em, etapa) values ($1, $2, 'E1', '2026-02-01', 'transporte'), ($1, $2, 'E2', '2026-02-02', 'concluido')`, [empA, ct]);
    await admin.query(`insert into priv.faturas (empresa_id, contrato_id, numero_nf, emitida_em, valor, retencoes, vencimento) values ($1, $2, 'NF1', '2026-03-01', 3000, 500, '2026-04-01')`, [empA, ct]);
    await admin.query(`insert into priv.faturas (empresa_id, contrato_id, numero_nf, emitida_em, valor, retencoes, vencimento, pago_em, valor_recebido) values ($1, $2, 'NF2', '2026-03-02', 1000, 0, '2026-04-02', '2026-04-02', 1000)`, [empA, ct]);
    const tipo = (await admin.query<{ id: string }>(`select id from pub.tipos_documento limit 1`)).rows[0]?.id;
    const doc = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, $2, 'CND vencida') returning id`, [empA, tipo])).rows[0]?.id;
    await admin.query(`insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, validade, status_arquivo) values ($1, $2, 1, 'k/1', 'a.pdf', current_date - 5, 'liberado')`, [doc, empA]);
  });
  afterAll(async () => {
    await app.close();
  });

  it('os indicadores batem com os registros (contagens e somas conferidas à parte)', async () => {
    const d = (await http().get(`/empresas/${empA}/dashboard`).set(bearer(a)).expect(200)).body as Record<string, unknown>;
    expect(d).toMatchObject({
      disputasFuturas: 1, licitacoesGanhas: 1, valorGanho: '1000.5000', contratosAtivos: 1, entregasPendentes: 1, // E2 já concluído não conta
      valoresAReceber: '2500.0000', // NF1: 3.000 - 500 de retenção; NF2 já paga
      documentosVencidos: 1, documentosVencendo: 0, propostasPendentes: 0, analisesPendentes: 0, oportunidadesNovas: 0, prazosJuridicosAbertos: 0,
    });
  });

  it('quem não tem a permissão do módulo recebe null (nunca zero enganoso); B não vê nada de A', async () => {
    const d = (await http().get(`/empresas/${empA}/dashboard`).set(bearer(limitado)).expect(200)).body as Record<string, unknown>;
    expect([d['contratosAtivos'], d['entregasPendentes'], d['valoresAReceber'], d['documentosVencidos'], d['propostasPendentes'], d['analisesPendentes'], d['oportunidadesNovas']]).toEqual([null, null, null, null, null, null, null]);
    expect([d['licitacoesGanhas'], d['disputasFuturas']]).toEqual([1, 1]); // o que a agenda autoriza continua aparecendo
    await http().get(`/empresas/${empA}/dashboard`).set(bearer(b)).expect(404);
    const dB = (await http().get(`/empresas/${empB}/dashboard`).set(bearer(b)).expect(200)).body as Record<string, unknown>;
    expect([dB['licitacoesGanhas'], dB['valorGanho'], dB['contratosAtivos'], dB['valoresAReceber'], dB['documentosVencidos']]).toEqual([0, '0.0000', 0, '0.0000', 0]);
  });

  it('relatório comercial: vitórias, derrotas, taxa de sucesso, valores, motivos e produtos', async () => {
    const r = (await http().get(`/empresas/${empA}/relatorios/comercial`).set(bearer(limitado)).expect(200)).body as { participacoes: number; vitorias: number; derrotas: number; taxaSucessoPct: string; valorDisputado: string; valorGanho: string; motivos: { motivo: string; total: number }[]; produtos: { produto: string; total: number }[] };
    expect([r.participacoes, r.vitorias, r.derrotas, r.taxaSucessoPct, r.valorDisputado, r.valorGanho]).toEqual([3, 1, 2, '33.33', '3500.5000', '1000.5000']);
    expect(r.motivos.map((m) => m.motivo)).toContain('Atestado incompatível');
    expect(r.produtos.map((p) => [p.produto, p.total])).toEqual([['Marca 0 Mod', 2], ['Marca 1 Mod', 1]]);
    await http().get(`/empresas/${empA}/relatorios/comercial`).set(bearer(b)).expect(404);
    expect(((await http().get(`/empresas/${empB}/relatorios/comercial`).set(bearer(b)).expect(200)).body as { taxaSucessoPct: string | null }).taxaSucessoPct).toBeNull();
  });

  it('CSV de resultados: só com agenda/exportar, BOM, separador ; e valores do banco', async () => {
    const r = await http().get(`/empresas/${empA}/relatorios/resultados.csv`).set(bearer(limitado)).expect(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.text.startsWith('\uFEFFData;Órgão;Edital;')).toBe(true);
    expect(r.text.split('\r\n').filter(Boolean)).toHaveLength(4); // cabeçalho + 3 resultados
    expect(r.text).toContain('homologada');
    expect(r.text).toContain('1000.5000');
    await http().get(`/empresas/${empA}/relatorios/resultados.csv`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empA}/relatorios/resultados.csv`).set(bearer(semExportar)).expect(404); // sem exportar
  });
});
