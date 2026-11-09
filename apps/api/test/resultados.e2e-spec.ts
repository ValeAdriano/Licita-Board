import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Resultados da Fase 09: registro, gatilho de intenção de recurso, arrematação ≠ homologação, histórico pesquisável e A x B.
describe('resultados: fluxo e A x B', () => {
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

  let empA: string; let empB: string; let a: string; let b: string; let leitor: string;
  let acomp: string; let part: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Resultado A'); empB = await criarEmpresa('Resultado B');
    const [eA, eB, eL] = await Promise.all([criarUsuario('rs-a'), criarUsuario('rs-b'), criarUsuario('rs-l')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eL, empA, 'OPERADOR', ['agenda:visualizar', 'editais:visualizar']);
    [a, b, leitor] = await Promise.all([entrar(eA), entrar(eB), entrar(eL)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge, municipio) values ($1, 'Prefeitura de Resultado', 'PR', '4106902', 'Curitiba') returning id`, [cnpjFicticio()])).rows[0]?.id;
    const edital = (await admin.query<{ id: string }>(
      `insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, processo, objeto, hash_conteudo) values ($1, $2, $3, '9/2026', 'PROC-77', 'Aquisição de veículos utilitários', repeat('e', 64)) returning id`, [fonte, `RS-${crypto.randomUUID()}`, orgao])).rows[0]?.id;
    const item = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao) values ($1, 1, 'Veículo utilitário') returning id`, [edital])).rows[0]?.id;
    acomp = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empA, edital])).rows[0]?.id ?? '';
    part = (await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id, marca, modelo) values ($1, $2, $3, 'Marca Q', 'Modelo 1') returning id`, [empA, acomp, item])).rows[0]?.id ?? '';
  });
  afterAll(async () => {
    await app.close();
  });

  it('registra a arrematação (sem gatilho de recurso) e arrematada não é homologada', async () => {
    await http().post(`/empresas/${empA}/participacoes/${part}/resultado`).set(bearer(leitor)).send({ resultado: 'arrematada' }).expect(404); // só visualizar
    await http().post(`/empresas/${empA}/participacoes/${part}/resultado`).set(bearer(a)).send({ resultado: 'arrematada', valorFinal: 92000, classificacao: 1 }).expect(400); // number não é aceito
    await http().post(`/empresas/${empA}/participacoes/${part}/resultado`).set(bearer(a)).send({ resultado: 'ganhou' }).expect(400);
    await http().post(`/empresas/${empA}/participacoes/${part}/resultado`).set(bearer(a)).send({ resultado: 'arrematada', valorInicial: '100000', valorFinal: '92000.50', classificacao: 1, melhorLance: '92000.50' }).expect(200);
    const r = (await http().get(`/empresas/${empA}/participacoes/${part}/resultado`).set(bearer(leitor)).expect(200)).body as { resultado: string; valorFinal: string; gatilhoRecursal: boolean };
    expect([r.resultado, r.valorFinal, r.gatilhoRecursal]).toEqual(['arrematada', '92000.5000', false]);
    expect((await admin.query<{ status: string }>(`select status from priv.participacoes where id = $1`, [part])).rows[0]?.status).toBe('arrematada');
    expect((await admin.query(`select 1 from priv.agenda_eventos where acompanhamento_id = $1 and tipo = 'intencao_recurso'`, [acomp])).rowCount).toBe(0);
  });

  it('perda exige motivo e CNPJ válido; perder abre a intenção de recurso na agenda e enfileira o cálculo', async () => {
    const base = { resultado: 'perdida', valorInicial: '100000', valorFinal: '98000', classificacao: 3, melhorLance: '90000' };
    await http().post(`/empresas/${empA}/participacoes/${part}/resultado`).set(bearer(a)).send({ ...base, classificacao: undefined }).expect(400); // sem motivo
    await http().post(`/empresas/${empA}/participacoes/${part}/resultado`).set(bearer(a)).send({ ...base, classificacao: 3, vencedoraCnpj: '11111111111111', motivo: 'Preço menor' }).expect(400); // CNPJ inválido
    const jobs = Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'calcular_prazos'`)).rows[0]?.count);
    await http().post(`/empresas/${empA}/participacoes/${part}/resultado`).set(bearer(a)).send({ ...base, vencedoraCnpj: '11.222.333/0001-81', vencedoraNome: 'Concorrente Ltda', vencedoraMarcaModelo: 'Marca Z Modelo 9', motivo: 'Preço final menor que o nosso', habilitacao: 'habilitada' }).expect(200);
    expect((await admin.query(`select 1 from priv.agenda_eventos where acompanhamento_id = $1 and tipo = 'intencao_recurso'`, [acomp])).rowCount).toBe(1);
    expect(Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'calcular_prazos'`)).rows[0]?.count)).toBe(jobs + 1);
    expect((await admin.query<{ status: string }>(`select status from priv.participacoes where id = $1`, [part])).rows[0]?.status).toBe('perdida');
    expect((await admin.query(`select 1 from priv.resultados_item where participacao_id = $1`, [part])).rowCount).toBe(1); // corrigir não duplica
  });

  it('histórico pesquisável por texto, órgão, marca, ano e situação; B não vê nada', async () => {
    const lista = async (qs: string) => (await http().get(`/empresas/${empA}/resultados${qs}`).set(bearer(leitor)).expect(200)).body as { resultado: string; orgao: string }[];
    expect((await lista('')).map((x) => x.resultado)).toEqual(['perdida']);
    expect(await lista('?q=PROC-77')).toHaveLength(1);
    expect(await lista('?q=utilitários')).toHaveLength(1);
    expect(await lista('?orgao=curitiba')).toHaveLength(1);
    expect(await lista('?marca=modelo 9')).toHaveLength(1); // modelo da vencedora
    expect(await lista('?q=Concorrente')).toHaveLength(1);
    expect(await lista(`?ano=${String(new Date().getFullYear())}`)).toHaveLength(1);
    expect(await lista('?ano=2019')).toHaveLength(0);
    expect(await lista('?status=homologada,contratada')).toHaveLength(0);
    expect(await lista('?q=%25')).toHaveLength(0); // % literal não vira curinga
    await http().get(`/empresas/${empA}/resultados?q=x&extra=1`).set(bearer(leitor)).expect(400);
    await http().get(`/empresas/${empA}/resultados`).set(bearer(b)).expect(404);
    expect(((await http().get(`/empresas/${empB}/resultados`).set(bearer(b)).expect(200)).body as unknown[])).toHaveLength(0);
  });

  it('A x B: B não lê nem registra resultado de A, nem descobre ids', async () => {
    await http().get(`/empresas/${empA}/participacoes/${part}/resultado`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/participacoes/${part}/resultado`).set(bearer(b)).send({ resultado: 'cancelada' }).expect(404);
    // empresa de B na rota com o id de A: o banco não encontra a participação (sem revelar)
    await http().post(`/empresas/${empB}/participacoes/${part}/resultado`).set(bearer(b)).send({ resultado: 'cancelada' }).expect(404);
    expect(((await http().get(`/empresas/${empB}/participacoes/${part}/resultado`).set(bearer(b)).expect(200)).body)).toEqual({}); // sem resultado (e sem revelar a participação de A)
  });
  for (const dona of ['A', 'B'] as const) {
    it(`isolamento por endpoint: resultados de ${dona} intactos, sem evento ou job do invasor`, async () => {
      const empresa = dona === 'A' ? empA : empB;
      const outra = dona === 'A' ? empB : empA;
      const token = dona === 'A' ? a : b;
      const invasor = dona === 'A' ? b : a;
      const marcador = crypto.randomUUID();
      const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) select e.fonte_id, $2, e.orgao_id, $2, e.hash_conteudo from pub.editais e join priv.acompanhamentos a on a.edital_id = e.id where a.id = $1 returning id`, [acomp, marcador])).rows[0]?.id ?? '';
      const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empresa, edital])).rows[0]?.id ?? '';
      const item = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao) values ($1, 1, 'Item matriz') returning id`, [edital])).rows[0]?.id;
      const id = (await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values ($1, $2, $3) returning id`, [empresa, ac, item])).rows[0]?.id ?? '';
      const path = `participacoes/${id}/resultado`;
      await http().post(`/empresas/${empresa}/${path}`).set(bearer(token)).send({ resultado: 'arrematada', valorFinal: '9876.5432', classificacao: 1 }).expect(200);
      const get = async () => (await http().get(`/empresas/${empresa}/${path}`).set(bearer(token)).expect(200)).body as { valorFinal: string };
      const antes = await get();
      expect(antes.valorFinal).toBe('9876.5432');
      const historico = async () => (await http().get(`/empresas/${empresa}/resultados?q=${marcador}`).set(bearer(token)).expect(200)).body as unknown[];
      const lista = await historico(); expect(lista).toHaveLength(1);
      const snapshot = async () => (await admin.query<Record<string, unknown>>(`select to_jsonb(p) as participacao, (select jsonb_agg(r) from priv.resultados_item r where r.participacao_id = p.id) as resultados, (select jsonb_agg(e) from priv.agenda_eventos e where e.acompanhamento_id = p.acompanhamento_id) as eventos from priv.participacoes p where p.id = $1`, [id])).rows;
      const intactos = await snapshot();
      const jobs = (await admin.query("select id from ops.jobs where tipo = 'calcular_prazos' order by id")).rows;
      for (const e of [empresa, outra]) {
        const r = await http().get(`/empresas/${e}/${path}`).set(bearer(invasor)).expect(e === empresa ? 404 : 200);
        if (e === outra) expect(r.body).toEqual({});
        const h = await http().get(`/empresas/${e}/resultados?q=${marcador}`).set(bearer(invasor)).expect(e === empresa ? 404 : 200);
        if (e === outra) expect(h.body).toEqual([]);
        await http().post(`/empresas/${e}/${path}`).set(bearer(invasor)).send({ resultado: 'perdida', valorFinal: '1.0000', classificacao: 2, motivo: 'Tentativa fictícia de alteração' }).expect(404);
      }
      expect(await get()).toEqual(antes);
      expect(await historico()).toEqual(lista);
      expect(await snapshot()).toEqual(intactos);
      expect((await admin.query("select id from ops.jobs where tipo = 'calcular_prazos' order by id")).rows).toEqual(jobs);
    });
  }

  it('9.5 documentos posteriores: linha do tempo unificada, foto da habilitação, pendências, leitura no contrato e A x B', async () => {
    const hoje = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    // Resultado homologada abre pendência informativa homologada_sem_documento até anexar homologação
    await http().post(`/empresas/${empA}/participacoes/${part}/resultado`).set(bearer(a)).send({
      resultado: 'homologada', valorInicial: '100000', valorFinal: '91000', classificacao: 1,
    }).expect(200);

    const tl0 = (await http().get(`/empresas/${empA}/acompanhamentos/${acomp}/documentos-posteriores`).set(bearer(a)).expect(200)).body as {
      linhaDoTempo: Array<{ origem: string; tipo: string; id: string; documento: { id: string } | null }>;
      grupos: { propostas: boolean | null; juridico: boolean | null; contratos: boolean | null };
      pendencias: Array<{ codigo: string; participacaoId: string }>;
      contratoId: string | null;
    };
    expect(tl0.grupos).toEqual({ propostas: true, juridico: true, contratos: true });
    expect(tl0.pendencias).toEqual([{ codigo: 'homologada_sem_documento', participacaoId: part }]);

    // Validações: sem arquivo nem link, decisão sem subtipo, link http (T15)
    await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/documentos-posteriores`).set(bearer(a)).send({
      tipo: 'ata_sessao', dataAto: hoje,
    }).expect(400);
    await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/documentos-posteriores`).set(bearer(a)).send({
      tipo: 'decisao', dataAto: hoje, link: 'https://pncp.gov.br/decisao/1',
    }).expect(400);
    await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/documentos-posteriores`).set(bearer(a)).send({
      tipo: 'ata_sessao', dataAto: hoje, link: 'http://pncp.gov.br/ata/1',
    }).expect(400);

    // Registra homologação por link público https -> limpa pendência e não altera resultado (CA-8)
    const hom = (await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/documentos-posteriores`).set(bearer(a)).send({
      tipo: 'homologacao', dataAto: hoje, numero: 'HOM-2026', participacaoId: part, link: 'https://pncp.gov.br/homologacao/1', observacao: 'Publicada no DOU',
    }).expect(201)).body as { id: string };
    expect(hom.id).toBeTruthy();

    // Registra contrato como documento posterior antes de existir contrato cadastrado (CA-10)
    const tipoCt = (await admin.query<{ id: string }>(`select id from pub.tipos_documento where slug = 'contrato_assinado'`)).rows[0]?.id;
    const docCt = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, $2, 'Contrato assinado PDF') returning id`, [empA, tipoCt])).rows[0]?.id ?? '';
    await admin.query(`insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo, sha256) values ($1, $2, 1, 'docs/ct.pdf', 'ct.pdf', 'liberado', repeat('a', 64))`, [docCt, empA]);

    const regCt = (await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/documentos-posteriores`).set(bearer(a)).send({
      tipo: 'contrato', dataAto: hoje, numero: 'CT-99/2026', documentoId: docCt, observacao: 'Anexado antes do cadastro do contrato',
    }).expect(201)).body as { id: string };
    expect(regCt.id).toBeTruthy();

    // Cadastra contrato ligado ao acompanhamento -> recusa novo documento posterior de contrato/ata/empenho e exibe na aba de anexos do contrato (CA-10)
    const ctId = (await admin.query<{ id: string }>(`
      insert into priv.contratos (empresa_id, acompanhamento_id, tipo, numero, orgao, objeto, vigencia_inicio, vigencia_fim)
      values ($1, $2, 'contrato', 'CT-99/2026', 'Prefeitura de Resultado', 'Aquisição de veículos', current_date, current_date + 365)
      returning id`, [empA, acomp])).rows[0]?.id ?? '';
    await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/documentos-posteriores`).set(bearer(a)).send({
      tipo: 'empenho', dataAto: hoje, numero: 'EMP-1', link: 'https://pncp.gov.br/empenho/1',
    }).expect(400);

    const anexosContrato = (await http().get(`/empresas/${empA}/contratos/${ctId}/anexos`).set(bearer(a)).expect(200)).body as Array<{
      id: string; doAcompanhamento: boolean; tipoPosterior: string | null; documentoId: string | null;
    }>;
    expect(anexosContrato.some((x) => x.id === regCt.id && x.doAcompanhamento && x.tipoPosterior === 'contrato' && x.documentoId === docCt)).toBe(true);

    // CA-12: leitor tem só agenda:visualizar e editais:visualizar (sem documentos:visualizar e sem contratos:visualizar)
    const tlLeitor = (await http().get(`/empresas/${empA}/acompanhamentos/${acomp}/documentos-posteriores`).set(bearer(leitor)).expect(200)).body as {
      linhaDoTempo: Array<{ id: string; origem: string; documento: unknown }>;
      grupos: { propostas: boolean | null; juridico: boolean | null; contratos: boolean | null };
    };
    expect(tlLeitor.grupos).toEqual({ propostas: null, juridico: null, contratos: null });
    const itemCtLeitor = tlLeitor.linhaDoTempo.find((x) => x.id === regCt.id);
    expect(itemCtLeitor?.documento).toBeNull();

    // Foto da habilitação apresentada (CA-11)
    const tipoCnd = (await admin.query<{ id: string }>(`select id from pub.tipos_documento where slug = 'cnd_federal'`)).rows[0]?.id;
    const docCnd = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, $2, 'CND Federal') returning id`, [empA, tipoCnd])).rows[0]?.id ?? '';
    await admin.query(`insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo, validade, sha256) values ($1, $2, 1, 'docs/cnd.pdf', 'cnd.pdf', 'liberado', current_date + 60, repeat('b', 64))`, [docCnd, empA]);
    await admin.query(`insert into priv.checklist_exigencias (empresa_id, acompanhamento_id, tipo_id, aplicavel) values ($1, $2, $3, true)`, [empA, acomp, tipoCnd]);

    const hab = (await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/habilitacao-apresentada`).set(bearer(a)).send({ dataAto: hoje }).expect(201)).body as { gravados: number };
    expect(hab.gravados).toBe(1);

    // Remover documento posterior com motivo (soft delete)
    await http().post(`/empresas/${empA}/documentos-posteriores/${hom.id}/remover`).set(bearer(leitor)).send({ motivo: 'Sem permissão' }).expect(404);
    await http().post(`/empresas/${empA}/documentos-posteriores/${hom.id}/remover`).set(bearer(b)).send({ motivo: 'Tentativa cruzada' }).expect(404);
    await http().post(`/empresas/${empB}/documentos-posteriores/${hom.id}/remover`).set(bearer(b)).send({ motivo: 'Tentativa cruzada' }).expect(404);
    await http().post(`/empresas/${empA}/documentos-posteriores/${hom.id}/remover`).set(bearer(a)).send({ motivo: 'Anexado em duplicidade' }).expect(204);

    // CA-13: B não lista nem registra em acompanhamento de A
    await http().get(`/empresas/${empA}/acompanhamentos/${acomp}/documentos-posteriores`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empB}/acompanhamentos/${acomp}/documentos-posteriores`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/documentos-posteriores`).set(bearer(b)).send({
      tipo: 'ata_sessao', dataAto: hoje, link: 'https://pncp.gov.br/ata/x',
    }).expect(404);
    await http().post(`/empresas/${empB}/acompanhamentos/${acomp}/documentos-posteriores`).set(bearer(b)).send({
      tipo: 'ata_sessao', dataAto: hoje, link: 'https://pncp.gov.br/ata/x',
    }).expect(404);
    await http().post(`/empresas/${empB}/acompanhamentos/${acomp}/habilitacao-apresentada`).set(bearer(b)).send({ dataAto: hoje }).expect(404);
  });

});
