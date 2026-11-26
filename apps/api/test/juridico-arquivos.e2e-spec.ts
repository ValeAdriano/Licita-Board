import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Q-43 (spec fase-10, 10.4/10.6): recurso de terceiro e documentos da concorrente a partir de arquivo liberado pelo repositório documental.
// O texto vem de priv.documento_trechos (o worker extrai ao liberar); aqui os trechos são gravados direto, como o worker faria.
describe('jurídico: arquivo do recurso e da concorrente, A x B', () => {
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
  async function arquivo(empresa: string, tipo: string, status: string, paginas: string[]): Promise<string> {
    const doc = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao, sem_vencimento) values ($1, (select id from pub.tipos_documento where slug = $2), 'Arquivo de teste', true) returning id`, [empresa, tipo])).rows[0]?.id ?? '';
    const ver = (await admin.query<{ id: string }>(`insert into priv.documento_versoes (empresa_id, documento_id, versao, arquivo_chave, nome_original, status_arquivo) values ($1, $2, 1, $3, 'arquivo.pdf', $4) returning id`, [empresa, doc, `k-${crypto.randomUUID()}`, status])).rows[0]?.id;
    for (const [i, texto] of paginas.entries()) {
      await admin.query(`insert into priv.documento_trechos (empresa_id, documento_id, versao_id, pagina, ordem, texto) values ($1, $2, $3, $4, 1, $5)`, [empresa, doc, ver, i + 1, texto]);
    }
    return doc;
  }

  let empA: string; let empB: string; let b: string; let redator: string; let leitor: string;
  let acompA: string; let acompB: string; let partA: string; let partB: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Arquivos A'); empB = await criarEmpresa('Arquivos B');
    const [eB, eR, eL] = await Promise.all([criarUsuario('ja-b'), criarUsuario('ja-r'), criarUsuario('ja-l')]);
    await vincular(eB, empB);
    await vincular(eR, empA, 'JURIDICO', ['juridico:visualizar', 'juridico:elaborar_peca', 'agenda:visualizar']);
    await vincular(eL, empA, 'OPERADOR', ['juridico:visualizar', 'agenda:visualizar']);
    [b, redator, leitor] = await Promise.all([entrar(eB), entrar(eR), entrar(eL)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Arquivos', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values ($1, $2, $3, '7/2026', 'Objeto', repeat('1', 64)) returning id`, [fonte, `JA-${crypto.randomUUID()}`, orgao])).rows[0]?.id;
    const item = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao) values ($1, 1, 'Veículo utilitário') returning id`, [edital])).rows[0]?.id;
    for (const [emp, set] of [[empA, (a: string, p: string) => { acompA = a; partA = p; }], [empB, (a: string, p: string) => { acompB = a; partB = p; }]] as const) {
      const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [emp, edital])).rows[0]?.id ?? '';
      const pa = (await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values ($1, $2, $3) returning id`, [emp, ac, item])).rows[0]?.id ?? '';
      await admin.query(`insert into priv.resultados_item (empresa_id, participacao_id, resultado_final, motivo_perda, gatilho_recursal) values ($1, $2, 'perdida', 'Perdeu no lance', true)`, [emp, pa]);
      set(ac, pa);
    }
  });
  afterAll(async () => {
    await app.close();
  });

  it('recurso de terceiro a partir do arquivo: texto do arquivo, origem registrada, um dos dois (texto ou arquivo)', async () => {
    const rota = `/empresas/${empA}/juridico/acompanhamentos/${acompA}/recursos`;
    const corpo = { recorrente: 'Concorrente S/A', publicadoEm: '2026-11-10T12:00:00-03:00' };
    const doc = await arquivo(empA, 'recurso_terceiro_arquivo', 'liberado', ['A recorrente alega que a proposta não atende ao item 3.2 do edital.', 'Pede a desclassificação.']);
    await http().post(rota).set(bearer(redator)).send(corpo).expect(400); // nem texto nem arquivo
    await http().post(rota).set(bearer(redator)).send({ ...corpo, documentoId: doc, texto: 'x'.repeat(60) }).expect(400); // os dois
    await http().post(rota).set(bearer(leitor)).send({ ...corpo, documentoId: doc }).expect(404); // só visualizar
    const quarentena = await arquivo(empA, 'recurso_terceiro_arquivo', 'quarentena', []);
    await http().post(rota).set(bearer(redator)).send({ ...corpo, documentoId: quarentena }).expect(400);
    const privado = await arquivo(empA, 'contrato_social', 'liberado', ['Contrato social da própria empresa, que o jurídico não lê por aqui.']);
    await http().post(rota).set(bearer(redator)).send({ ...corpo, documentoId: privado }).expect(400);
    const ins = (await http().post(rota).set(bearer(redator)).send({ ...corpo, documentoId: doc }).expect(201)).body as { id: string; pecaId: string; caracteres: number };
    expect(ins.pecaId).toBeTruthy();
    const d = (await http().get(`/empresas/${empA}/juridico/recursos/${ins.id}`).set(bearer(leitor)).expect(200)).body as { texto: string; arquivos: { documentoId: string; nome: string; caracteres: number }[] };
    expect(d.texto).toBe('[página 1]\nA recorrente alega que a proposta não atende ao item 3.2 do edital.\n\n[página 2]\nPede a desclassificação.');
    expect(d.arquivos.map((x) => [x.documentoId, x.nome, x.caracteres])).toEqual([[doc, 'arquivo.pdf', ins.caracteres]]);
    // o recurso colado continua igual e não tem arquivo
    const colado = (await http().post(rota).set(bearer(redator)).send({ ...corpo, recorrente: 'Outra S/A', texto: 'Recurso colado com texto suficiente para passar do mínimo de cinquenta.' }).expect(201)).body as { id: string };
    expect(((await http().get(`/empresas/${empA}/juridico/recursos/${colado.id}`).set(bearer(leitor)).expect(200)).body as { arquivos: unknown[] }).arquivos).toEqual([]);
  });

  it('parecer: anexa proposta e habilitação da vencedora ao texto, sem repetir', async () => {
    const b0 = `/empresas/${empA}/juridico/pareceres`;
    const parecer = ((await http().post(`${b0}/participacao/${partA}`).set(bearer(redator)).send({ concorrente: 'Concorrente S/A', texto: 'Texto colado.' }).expect(201)).body as { id: string }).id;
    const hab = await arquivo(empA, 'habilitacao_concorrente', 'liberado', ['Certidão negativa de débitos válida até 01/10/2026, emitida pela Receita.']);
    const prop = await arquivo(empA, 'proposta_concorrente', 'liberado', ['Proposta da vencedora: marca XPTO, modelo 2026, valor global conforme planilha.']);
    await http().post(`${b0}/${parecer}/arquivos`).set(bearer(leitor)).send({ documentoId: hab }).expect(404);
    await http().post(`${b0}/${parecer}/arquivos`).set(bearer(redator)).send({ documentoId: 'nao-uuid' }).expect(400);
    await http().post(`${b0}/${parecer}/arquivos`).set(bearer(redator)).send({ documentoId: hab }).expect(201);
    await http().post(`${b0}/${parecer}/arquivos`).set(bearer(redator)).send({ documentoId: hab }).expect(400); // já anexado
    await http().post(`${b0}/${parecer}/arquivos`).set(bearer(redator)).send({ documentoId: prop }).expect(201);
    await http().post(`${b0}/${crypto.randomUUID()}/arquivos`).set(bearer(redator)).send({ documentoId: prop }).expect(404);
    const d = (await http().get(`${b0}/participacao/${partA}`).set(bearer(leitor)).expect(200)).body as { parecer: { texto: string; bloqueado: boolean }; arquivos: { documentoId: string }[] };
    expect(d.parecer.texto.startsWith('Texto colado.\n\n[arquivo: arquivo.pdf]\n[página 1]\nCertidão negativa')).toBe(true);
    expect(d.parecer.texto.endsWith('[página 1]\nProposta da vencedora: marca XPTO, modelo 2026, valor global conforme planilha.')).toBe(true);
    expect(d.arquivos.map((x) => x.documentoId)).toEqual([hab, prop]);
    expect(d.parecer.bloqueado).toBe(true); // o texto novo pede nova conferência da evidência
  });

  it('A x B: nenhum lado usa arquivo, recurso ou parecer do outro', async () => {
    const docA = await arquivo(empA, 'recurso_terceiro_arquivo', 'liberado', ['Recurso guardado pela empresa A, com texto suficiente para leitura.']);
    const habA = await arquivo(empA, 'habilitacao_concorrente', 'liberado', ['Habilitação da vencedora guardada pela empresa A, com texto suficiente.']);
    const parecerA = (await admin.query<{ id: string }>(`select id from priv.pareceres_recursais where participacao_id = $1`, [partA])).rows[0]?.id ?? '';
    const corpo = { recorrente: 'Invasor', publicadoEm: '2026-11-10T12:00:00-03:00' };
    // B pela rota de A
    await http().post(`/empresas/${empA}/juridico/acompanhamentos/${acompA}/recursos`).set(bearer(b)).send({ ...corpo, documentoId: docA }).expect(404);
    await http().post(`/empresas/${empA}/juridico/pareceres/${parecerA}/arquivos`).set(bearer(b)).send({ documentoId: habA }).expect(404);
    // B pela própria rota, com ids de A
    await http().post(`/empresas/${empB}/juridico/acompanhamentos/${acompB}/recursos`).set(bearer(b)).send({ ...corpo, documentoId: docA }).expect(404);
    const parecerB = ((await http().post(`/empresas/${empB}/juridico/pareceres/participacao/${partB}`).set(bearer(b)).send({ concorrente: 'Concorrente S/A' }).expect(201)).body as { id: string }).id;
    await http().post(`/empresas/${empB}/juridico/pareceres/${parecerB}/arquivos`).set(bearer(b)).send({ documentoId: habA }).expect(404);
    await http().post(`/empresas/${empB}/juridico/pareceres/${parecerA}/arquivos`).set(bearer(b)).send({ documentoId: habA }).expect(404);
    // A (redator) pela própria rota, com arquivo de B
    const habB = await arquivo(empB, 'habilitacao_concorrente', 'liberado', ['Habilitação guardada pela empresa B, com texto suficiente para leitura.']);
    await http().post(`/empresas/${empA}/juridico/pareceres/${parecerA}/arquivos`).set(bearer(redator)).send({ documentoId: habB }).expect(404);
    await http().post(`/empresas/${empA}/juridico/pareceres/${parecerB}/arquivos`).set(bearer(redator)).send({ documentoId: habA }).expect(404);
    // nada mudou do outro lado
    expect((await admin.query<{ n: string }>(`select count(*) n from priv.juridico_arquivos where empresa_id = $1`, [empB])).rows[0]?.n).toBe('0');
    expect((await admin.query<{ texto: string | null }>(`select texto_concorrente texto from priv.pareceres_recursais where id = $1`, [parecerB])).rows[0]?.texto).toBeNull();
  });
});
