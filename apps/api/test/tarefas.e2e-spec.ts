import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Central de trabalho do Início: pendências com link direto, só dos módulos permitidos, ordem por urgência e A x B.
describe('tarefas: central de trabalho, permissões e A x B', () => {
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

  let empA: string; let empB: string; let a: string; let b: string; let juridico: string; let ac: string; let peca: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Tarefas A'); empB = await criarEmpresa('Tarefas B');
    const [eA, eB, eJ] = await Promise.all([criarUsuario('ta-a'), criarUsuario('ta-b'), criarUsuario('ta-j')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eJ, empA, 'JURIDICO', ['relatorios:visualizar', 'juridico:visualizar', 'juridico:aprovar_peca']); // só o jurídico
    [a, b, juridico] = await Promise.all([entrar(eA), entrar(eB), entrar(eJ)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Prefeitura Tarefas', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values ($1, $2, $3, '3/2026', 'Objeto', repeat('4', 64)) returning id`, [fonte, `TA-${crypto.randomUUID()}`, orgao])).rows[0]?.id;
    ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id, data_abertura) values ($1, $2, now() + interval '1 day') returning id`, [empA, edital])).rows[0]?.id ?? '';
    await admin.query(`insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, data_limite_legal, status) values ($1, $2, 'impugnacao', now() - interval '3 hours', 'em_elaboracao')`, [empA, ac]);
    peca = (await admin.query<{ id: string }>(`insert into priv.pecas (empresa_id, acompanhamento_id, tipo, titulo, status) values ($1, $2, 'impugnacao', 'Impugnação ao item 3', 'revisao') returning id`, [empA, ac])).rows[0]?.id ?? '';
    const tipo = (await admin.query<{ id: string }>(`select id from pub.tipos_documento limit 1`)).rows[0]?.id;
    const doc = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, $2, 'CND vencida') returning id`, [empA, tipo])).rows[0]?.id;
    await admin.query(`insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, validade, status_arquivo) values ($1, $2, 1, 'k/1', 'a.pdf', current_date - 10, 'liberado')`, [doc, empA]);
  });
  afterAll(async () => {
    await app.close();
  });

  interface T { itens: { id: string; modulo: string; nivel: string; titulo: string; link: string }[]; contagens: Record<string, number> }

  it('lista as pendências com link direto e a ordem urgente → atenção; contagens por módulo para os selos do menu', async () => {
    const r = (await http().get(`/empresas/${empA}/tarefas`).set(bearer(a)).expect(200)).body as T;
    const por = (prefixo: string) => r.itens.find((x) => x.id.startsWith(prefixo));
    expect(por('prazo:')).toMatchObject({ modulo: 'agenda', nivel: 'urgente', link: `/agenda/acompanhamentos/${ac}` }); // prazo vencido
    expect(por('disputa:')).toMatchObject({ link: `/agenda/acompanhamentos/${ac}` }); // abertura em 1 dia
    expect(por('aprovar:')).toMatchObject({ modulo: 'juridico', nivel: 'atencao', link: `/juridico/pecas/${peca}` });
    expect(por('docs-vencidos')).toMatchObject({ nivel: 'urgente', link: '/cadastros' });
    const niveis = r.itens.map((x) => x.nivel);
    expect(niveis).toEqual([...niveis].sort((x, y) => ['urgente', 'atencao', 'info'].indexOf(x) - ['urgente', 'atencao', 'info'].indexOf(y)));
    expect(r.contagens.agenda).toBeGreaterThanOrEqual(2);
    expect(r.contagens.juridico).toBe(1);
    expect(r.contagens.cadastros).toBe(1);
  });

  it('quem só vê o jurídico recebe só as tarefas do jurídico; sem a permissão da rota é 404', async () => {
    const r = (await http().get(`/empresas/${empA}/tarefas`).set(bearer(juridico)).expect(200)).body as T;
    expect([...new Set(r.itens.map((x) => x.modulo))]).toEqual(['juridico']);
    expect(r.itens.map((x) => x.link)).toEqual([`/juridico/pecas/${peca}`]);
  });

  it('A x B: B não lê as tarefas de A e a lista de B não traz nada de A', async () => {
    await http().get(`/empresas/${empA}/tarefas`).set(bearer(b)).expect(404);
    const r = (await http().get(`/empresas/${empB}/tarefas`).set(bearer(b)).expect(200)).body as T;
    expect(r.itens).toEqual([]);
    await http().get(`/empresas/${empB}/tarefas`).set(bearer(a)).expect(404);
  });
});
