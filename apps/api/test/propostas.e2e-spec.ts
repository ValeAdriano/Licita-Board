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
    await http().post(`/empresas/${empA}/propostas/${prop}/dados`).set(bearer(editor)).send({ validadeDias: 90 }).expect(400); // só rascunho se edita (estado, 22023; Q-35)
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
    await http().post(`/empresas/${empA}/propostas/${v2}/pdf`).set(bearer(leitor)).expect(400); // rascunho não tem PDF (estado, 22023; Q-35)
    expect([200, 503]).toContain(dl.status); // 503 quando o armazenamento de teste não está ligado; nunca 404 para quem vê
  });

  it('validação real de proposta visível continua 400 nas três ações', async () => {
    // A versão 2 é um rascunho ainda não validado pelo worker.
    for (const acao of ['conferir', 'devolver', 'aprovar']) {
      await http().post(`/empresas/${empA}/propostas/${v2}/${acao}`).set(bearer(a)).send({}).expect(400);
    }
    await http().post(`/empresas/${empA}/propostas/${v2}/aprovar`).set(bearer(a)).send({ stepUp: 'inválido' }).expect(400);
  });

  it('8.7 comprovante de envio: exige proposta final e comprovante liberado, move participação, avisa envio tardio, oculta arquivo sem documentos/visualizar e anula com motivo', async () => {
    const tipoComprovante = (await admin.query<{ id: string }>(`select id from pub.tipos_documento where slug = 'comprovante_envio_proposta'`)).rows[0]?.id ?? '';
    const tipoErrado = (await admin.query<{ id: string }>(`select id from pub.tipos_documento where slug = 'cnd_federal'`)).rows[0]?.id ?? '';

    const docErrado = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, $2, 'Tipo errado') returning id`, [empA, tipoErrado])).rows[0]?.id ?? '';
    await admin.query(`insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo) values ($1, $2, 1, 'docs/err.pdf', 'err.pdf', 'liberado')`, [docErrado, empA]);

    const docQuarentena = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, $2, 'Em quarentena') returning id`, [empA, tipoComprovante])).rows[0]?.id ?? '';
    await admin.query(`insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo) values ($1, $2, 1, 'docs/q.pdf', 'q.pdf', 'quarentena')`, [docQuarentena, empA]);

    const docOk = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, $2, 'Comprovante Compras.gov') returning id`, [empA, tipoComprovante])).rows[0]?.id ?? '';
    const verOk = (await admin.query<{ id: string }>(`insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo, sha256) values ($1, $2, 1, 'docs/ok.pdf', 'recibo.pdf', 'liberado', repeat('c', 64)) returning id`, [docOk, empA])).rows[0]?.id ?? '';

    const docB = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, $2, 'Comprovante B') returning id`, [empB, tipoComprovante])).rows[0]?.id ?? '';
    await admin.query(`insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo) values ($1, $2, 1, 'docs/b.pdf', 'b.pdf', 'liberado')`, [docB, empB]);

    const agora = new Date(Date.now() - 60_000).toISOString();
    const futuro = new Date(Date.now() + 3600_000).toISOString();

    // CA-6: proposta rascunho (v2) recusada
    await http().post(`/empresas/${empA}/propostas/${v2}/envios`).set(bearer(a))
      .send({ enviadoEm: agora, formato: 'docx', documentoId: docOk }).expect(400);

    // CA-7: tipo errado, quarentena, data futura -> 400; documento de outra empresa -> 404
    await http().post(`/empresas/${empA}/propostas/${prop}/envios`).set(bearer(a))
      .send({ enviadoEm: agora, formato: 'docx', documentoId: docErrado }).expect(400);
    await http().post(`/empresas/${empA}/propostas/${prop}/envios`).set(bearer(a))
      .send({ enviadoEm: agora, formato: 'docx', documentoId: docQuarentena }).expect(400);
    await http().post(`/empresas/${empA}/propostas/${prop}/envios`).set(bearer(a))
      .send({ enviadoEm: futuro, formato: 'docx', documentoId: docOk }).expect(400);
    await http().post(`/empresas/${empA}/propostas/${prop}/envios`).set(bearer(a))
      .send({ enviadoEm: agora, formato: 'docx', documentoId: docB }).expect(404);

    // Permissão: editor (sem propostas/aprovar) -> 404
    await http().post(`/empresas/${empA}/propostas/${prop}/envios`).set(bearer(editor))
      .send({ enviadoEm: agora, formato: 'docx', documentoId: docOk }).expect(404);

    // CA-10: define data_abertura no passado para gerar aviso não bloqueante envio_apos_encerramento
    await admin.query(`update priv.acompanhamentos set data_abertura = now() - interval '2 hours', portal = 'Compras.gov.br' where id = $1`, [acomp]);

    const reg = await http().post(`/empresas/${empA}/propostas/${prop}/envios`).set(bearer(a))
      .send({ enviadoEm: agora, formato: 'docx', identificadorPortal: 'REC-99', documentoId: docOk, observacao: 'Protocolado pela equipe' }).expect(201);
    const envioBody = reg.body as { id: string; avisos: string[] };
    expect(envioBody.avisos).toContain('envio_apos_encerramento');

    // CA-9: participação movida para proposta_cadastrada
    expect((await admin.query<{ status: string }>(`select status from priv.participacoes where acompanhamento_id = $1`, [acomp])).rows[0]?.status).toBe('proposta_cadastrada');

    // Lista de envios: 'a' tem documentos/visualizar -> vê comprovante; 'leitor' não tem documentos/visualizar -> comprovante === null
    const enviosA = (await http().get(`/empresas/${empA}/propostas/${prop}/envios`).set(bearer(a)).expect(200)).body as {
      envios: { id: string; propostaVersao: number; propostaSha256: string; portal: string; comprovante: { documentoId: string; versaoId: string; nome: string } | null; avisos: string[] }[];
    };
    expect(enviosA.envios).toHaveLength(1);
    expect(enviosA.envios[0]?.propostaVersao).toBe(1);
    expect(enviosA.envios[0]?.propostaSha256).toBe('b'.repeat(64));
    expect(enviosA.envios[0]?.portal).toBe('Compras.gov.br');
    expect(enviosA.envios[0]?.comprovante).toMatchObject({ documentoId: docOk, versaoId: verOk, nome: 'recibo.pdf' });

    const enviosLeitor = (await http().get(`/empresas/${empA}/propostas/${prop}/envios`).set(bearer(leitor)).expect(200)).body as {
      envios: { id: string; comprovante: unknown }[];
    };
    expect(enviosLeitor.envios).toHaveLength(1);
    expect(enviosLeitor.envios[0]?.comprovante).toBeNull();

    // Lista de propostas traz ultimoEnvio
    const listaProp = (await http().get(`/empresas/${empA}/acompanhamentos/${acomp}/propostas`).set(bearer(a)).expect(200)).body as {
      propostas: { id: string; ultimoEnvio: { id: string; identificadorPortal: string } | null }[];
    };
    expect(listaProp.propostas.find((p) => p.id === prop)?.ultimoEnvio?.id).toBe(envioBody.id);

    // Anulação exige motivo >= 10 caracteres e só ocorre uma vez
    await http().post(`/empresas/${empA}/proposta-envios/${envioBody.id}/anular`).set(bearer(a)).send({ motivo: 'curto' }).expect(400);
    await http().post(`/empresas/${empA}/proposta-envios/${envioBody.id}/anular`).set(bearer(a)).send({ motivo: 'Substituído por nova versão no portal' }).expect(204);
    await http().post(`/empresas/${empA}/proposta-envios/${envioBody.id}/anular`).set(bearer(a)).send({ motivo: 'Tentando anular novamente' }).expect(400);
  });

  it('A x B: B não lê, não cria nem altera nada de A, nem baixa a final', async () => {
    await http().get(`/empresas/${empA}/acompanhamentos/${acomp}/propostas`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/acompanhamentos/${acomp}/propostas`).set(bearer(b)).send({}).expect(404);
    await http().get(`/empresas/${empA}/propostas/${prop}/envios`).set(bearer(b)).expect(404);
    for (const acao of ['conferir', 'aprovar', 'devolver', 'validar', 'nova-versao', 'download', 'pdf']) {
      await http().post(`/empresas/${empA}/propostas/${v2}/${acao}`).set(bearer(b)).send({}).expect(404);
    }
    // empresa de B na rota com ids de A: o banco não encontra
    await http().get(`/empresas/${empB}/acompanhamentos/${acomp}/propostas`).set(bearer(b)).expect(200).then((r) => { expect((r.body as { propostas: unknown[] }).propostas).toHaveLength(0); });
    await http().get(`/empresas/${empB}/propostas/${prop}/envios`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empB}/propostas/${prop}/download`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empB}/propostas/${v2}/aprovar`).set(bearer(b)).expect(404); // proposta de outra empresa não é visível
    await http().post(`/empresas/${empB}/acompanhamentos/${acomp}/propostas`).set(bearer(b)).send({}).expect(404);
  });
  for (const dona of ['A', 'B'] as const) {
    it(`isolamento por endpoint: propostas de ${dona} intactas, sem jobs ou URL para invasor`, async () => {
      const empresa = dona === 'A' ? empA : empB;
      const outra = dona === 'A' ? empB : empA;
      const token = dona === 'A' ? a : b;
      const su = await stepUp(app, dona === 'A' ? b : a, 'proposta_final');
      if (dona === 'A') b = su.token; else a = su.token;
      const invasor = su.token;
      const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) select e.fonte_id, $2, e.orgao_id, e.objeto, e.hash_conteudo from pub.editais e join priv.acompanhamentos a on a.edital_id = e.id where a.id = $1 returning id`, [acomp, crypto.randomUUID()])).rows[0]?.id ?? '';
      const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empresa, edital])).rows[0]?.id ?? '';
      const item = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao, quantidade) values ($1, 1, 'Item matriz', 10) returning id`, [edital])).rows[0]?.id;
      const part = (await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values ($1, $2, $3) returning id`, [empresa, ac, item])).rows[0]?.id;
      await admin.query(`insert into priv.precificacoes (empresa_id, participacao_id, quantidade, calculado_em, preco_final_unit, total_proposta, aprovado_em, aprovado_por) values ($1, $2, 10, now(), 125, 1250, now(), (select usuario_id from core.vinculos where empresa_id = $1 limit 1))`, [empresa, part]);
      const id = ((await http().post(`/empresas/${empresa}/acompanhamentos/${ac}/propostas`).set(bearer(token)).send({}).expect(201)).body as { id: string }).id;
      await admin.query(`update priv.propostas set validada_em = now(), bloqueada = false where id = $1`, [id]);
      const final = (await admin.query<{ id: string }>(`insert into priv.propostas (empresa_id, acompanhamento_id, versao, status, conteudo, total, arquivo_chave, arquivo_pdf_chave, arquivo_pdf_sha256, arquivo_sha256) values ($1, $2, 2, 'final', '[]', 1250, 'propostas/matriz.docx', 'propostas/matriz.pdf', repeat('b', 64), repeat('a', 64)) returning id`, [empresa, ac])).rows[0]?.id ?? '';
      const conferencia = (await admin.query<{ id: string }>(`insert into priv.propostas (empresa_id, acompanhamento_id, versao, status, conteudo, total, bloqueada, validada_em) values ($1, $2, 3, 'conferencia', '[]', 1250, false, now()) returning id`, [empresa, ac])).rows[0]?.id ?? '';
      const docMatriz = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, (select id from pub.tipos_documento where slug = 'comprovante_envio_proposta'), 'Comp matriz') returning id`, [empresa])).rows[0]?.id ?? '';
      const verMatriz = (await admin.query<{ id: string }>(`insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo) values ($1, $2, 1, 'docs/m.pdf', 'm.pdf', 'liberado') returning id`, [docMatriz, empresa])).rows[0]?.id ?? '';
      const envioMatriz = (await admin.query<{ id: string }>(`insert into priv.proposta_envios (empresa_id, proposta_id, proposta_versao, formato, enviado_em, comprovante_documento_id, comprovante_versao_id, registrado_por) values ($1, $2, 2, 'pdf', now() - interval '5 minutes', $3, $4, (select usuario_id from core.vinculos where empresa_id = $1 limit 1)) returning id`, [empresa, final, docMatriz, verMatriz])).rows[0]?.id ?? '';
      const get = async () => (await http().get(`/empresas/${empresa}/acompanhamentos/${ac}/propostas`).set(bearer(token)).expect(200)).body as { propostas: { total: string }[] };
      const antes = await get();
      expect(antes.propostas).toHaveLength(3);
      expect(antes.propostas[0]?.total).toBe('1250.0000');
      const snapshot = async () => (await admin.query<Record<string, unknown>>('select * from priv.propostas where acompanhamento_id = $1 order by id', [ac])).rows;
      const intactas = await snapshot();
      const jobs = (await admin.query("select id from ops.jobs where tipo = 'gerar_proposta' order by id")).rows;
      const rotas: { path: string; corpo?: object; compararInexistente?: boolean }[] = [
        { path: `acompanhamentos/${ac}/propostas` },
        { path: `propostas/${id}/dados`, corpo: { validadeDias: 99 } },
        { path: `propostas/${id}/validar` },
        { path: `propostas/${id}/conferir`, compararInexistente: true },
        { path: `propostas/${conferencia}/devolver`, compararInexistente: true },
        { path: `propostas/${conferencia}/aprovar`, corpo: { stepUp: su.id }, compararInexistente: true },
        { path: `propostas/${final}/nova-versao` },
        { path: `propostas/${final}/download`, corpo: { formato: 'docx' } },
        { path: `propostas/${final}/download`, corpo: { formato: 'pdf' } },
        { path: `propostas/${final}/pdf` },
        { path: `propostas/${final}/envios`, corpo: { enviadoEm: new Date(Date.now() - 60_000).toISOString(), formato: 'pdf', documentoId: docMatriz }, compararInexistente: true },
        { path: `proposta-envios/${envioMatriz}/anular`, corpo: { motivo: 'Tentativa de anular envio alheio' }, compararInexistente: true },
      ];
      for (const e of [empresa, outra]) {
        const lista = await http().get(`/empresas/${e}/acompanhamentos/${ac}/propostas`).set(bearer(invasor)).expect(e === empresa ? 404 : 200);
        if (e === outra) expect((lista.body as { propostas: unknown[] }).propostas).toEqual([]);
        await http().get(`/empresas/${e}/propostas/${final}/envios`).set(bearer(invasor)).expect(404);
        for (const rota of rotas) {
          const r = await http().post(`/empresas/${e}/${rota.path}`).set(bearer(invasor)).send(rota.corpo ?? {}).expect(404);
          expect(r.body).not.toHaveProperty('url');
          // Recurso alheio e inexistente têm a mesma resposta 404.
          if (e === outra && rota.compararInexistente) {
            const inexistente = rota.path
              .replace(id, crypto.randomUUID())
              .replace(conferencia, crypto.randomUUID())
              .replace(final, crypto.randomUUID())
              .replace(envioMatriz, crypto.randomUUID());
            const controle = await http().post(`/empresas/${e}/${inexistente}`).set(bearer(invasor)).send(rota.corpo ?? {}).expect(404);
            expect(r.body).toEqual(controle.body);
          }
        }
      }
      expect(await get()).toEqual(antes);
      expect(await snapshot()).toEqual(intactas);
      expect((await admin.query("select id from ops.jobs where tipo = 'gerar_proposta' order by id")).rows).toEqual(jobs);
    });
  }

});
