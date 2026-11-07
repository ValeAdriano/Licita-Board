import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, lembrarMfa, stepUp, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Jurídico da Fase 10: base verificada, fluxo da peça com permissões, aprovação, protocolo humano, final imutável e A x B.
describe('jurídico: fluxo e A x B', () => {
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

  let empA: string; let empB: string; let a: string; let b: string; let redator: string; let leitor: string;
  let acomp: string; let evento: string; let peca: string; let base165: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Jurídico A'); empB = await criarEmpresa('Jurídico B');
    const [eA, eB, eR, eL] = await Promise.all([criarUsuario('ju-a'), criarUsuario('ju-b'), criarUsuario('ju-r'), criarUsuario('ju-l')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eR, empA, 'JURIDICO', ['juridico:visualizar', 'juridico:elaborar_peca', 'agenda:visualizar']);
    await vincular(eL, empA, 'OPERADOR', ['juridico:visualizar', 'agenda:visualizar']);
    [a, b, redator, leitor] = await Promise.all([entrar(eA), entrar(eB), entrar(eR), entrar(eL)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Jurídico', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values ($1, $2, $3, '3/2026', 'Objeto', repeat('1', 64)) returning id`, [fonte, `JU-${crypto.randomUUID()}`, orgao])).rows[0]?.id;
    acomp = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empA, edital])).rows[0]?.id ?? '';
    evento = (await admin.query<{ id: string }>(`insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, data_limite_legal) values ($1, $2, 'impugnacao', now() + interval '5 days') returning id`, [empA, acomp])).rows[0]?.id ?? '';
  });
  afterAll(async () => {
    await app.close();
  });

  it('base jurídica nasce vazia; cadastro exige link https; verificar é de quem aprova', async () => {
    expect(((await http().get(`/empresas/${empA}/juridico/base`).set(bearer(leitor)).expect(200)).body as unknown[])).toHaveLength(0);
    const e = { tipo: 'lei', numero: '14.133/2021', dispositivo: 'art. 165', titulo: 'Lei 14.133/2021, art. 165', linkOficial: 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm' };
    await http().post(`/empresas/${empA}/juridico/base`).set(bearer(leitor)).send(e).expect(404); // só visualizar
    await http().post(`/empresas/${empA}/juridico/base`).set(bearer(redator)).send({ ...e, linkOficial: 'http://inseguro.exemplo' }).expect(400);
    base165 = ((await http().post(`/empresas/${empA}/juridico/base`).set(bearer(redator)).send(e).expect(201)).body as { id: string }).id;
    await http().post(`/empresas/${empA}/juridico/base/${base165}/verificar`).set(bearer(redator)).expect(404); // redator não verifica
    await http().post(`/empresas/${empA}/juridico/base/${base165}/verificar`).set(bearer(a)).expect(204);
    const l = (await http().get(`/empresas/${empA}/juridico/base`).set(bearer(leitor)).expect(200)).body as { id: string; verificadaEm: string | null }[];
    expect(l.find((x) => x.id === base165)?.verificadaEm).not.toBeNull();
  });

  it('cria a peça ligada ao evento da agenda; minuta enfileira a conferência; descarte exige justificativa', async () => {
    await http().post(`/empresas/${empA}/juridico/acompanhamentos/${acomp}/pecas`).set(bearer(leitor)).send({ tipo: 'impugnacao', titulo: 'Impugnação' }).expect(404);
    const r = await http().post(`/empresas/${empA}/juridico/acompanhamentos/${acomp}/pecas`).set(bearer(redator)).send({ tipo: 'impugnacao', titulo: 'Impugnação ao item 3', eventoId: evento }).expect(201);
    peca = (r.body as { id: string }).id;
    const jobs = Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'processar_peca'`)).rows[0]?.count);
    await http().put(`/empresas/${empA}/juridico/pecas/${peca}/minuta`).set(bearer(redator)).send({ minuta: 'Violação do art. 165 da Lei 14.133/2021 pela cláusula 7.2.', clausulas: 'Cláusula 7.2, página 12' }).expect(202);
    expect(Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'processar_peca'`)).rows[0]?.count)).toBe(jobs + 1);
    const lista = (await http().get(`/empresas/${empA}/juridico/pecas`).set(bearer(leitor)).expect(200)).body as { id: string; status: string; prazoLegal: string | null }[];
    expect(lista.map((p) => [p.id, p.status, p.prazoLegal !== null])).toEqual([[peca, 'minuta', true]]); // prazo vem do evento da agenda
    await http().post(`/empresas/${empA}/juridico/pecas/${peca}/descartar`).set(bearer(redator)).send({ justificativa: 'curta' }).expect(400);
    await http().post(`/empresas/${empA}/juridico/pecas/${peca}/revisao`).set(bearer(redator)).expect(400); // o worker ainda não validou
  });

  it('fluxo: revisão só validada; aprovar só com aprovar_peca; protocolo é humano e marca o evento; final imutável', async () => {
    await admin.query(`update priv.pecas set validada_em = now(), bloqueada = false where id = $1`, [peca]); // worker simulado
    await http().post(`/empresas/${empA}/juridico/pecas/${peca}/revisao`).set(bearer(redator)).expect(204);
    await http().post(`/empresas/${empA}/juridico/pecas/${peca}/aprovar`).set(bearer(redator)).expect(404);
    await http().post(`/empresas/${empA}/juridico/pecas/${peca}/aprovar`).set(bearer(a)).expect(403); // sem a reautenticação (step-up) não aprova
    const su = await stepUp(app, a, 'aprovar_peca'); a = su.token;
    await http().post(`/empresas/${empA}/juridico/pecas/${peca}/aprovar`).set(bearer(a)).send({ stepUp: su.id }).expect(202);
    await http().post(`/empresas/${empA}/juridico/pecas/${peca}/aprovar`).set(bearer(a)).send({ stepUp: su.id }).expect(400); // já aprovada (o token é de uso único)
    await http().post(`/empresas/${empA}/juridico/pecas/${peca}/protocolo`).set(bearer(redator)).send({ numero: '2026/1', quando: '2026-11-10T10:00:00-03:00' }).expect(400); // sem documento final
    await http().post(`/empresas/${empA}/juridico/pecas/${peca}/download`).set(bearer(leitor)).send({}).expect(404);
    await admin.query(`update priv.pecas set status = 'final', arquivo_chave = 'pecas/x.docx', arquivo_sha256 = repeat('d', 64), gerado_em = now() where id = $1`, [peca]); // worker simulado
    await http().post(`/empresas/${empA}/juridico/pecas/${peca}/devolver`).set(bearer(a)).expect(400); // final não volta
    await http().put(`/empresas/${empA}/juridico/pecas/${peca}/minuta`).set(bearer(redator)).send({ minuta: 'alterada' }).expect(400);
    await http().post(`/empresas/${empA}/juridico/pecas/${peca}/protocolo`).set(bearer(redator)).send({ numero: '2026/1', quando: '2026-11-10T10:00:00-03:00', comprovante: 'Comprovante do portal' }).expect(204);
    expect((await admin.query<{ status: string }>(`select status from priv.agenda_eventos where id = $1`, [evento])).rows[0]?.status).toBe('protocolado');
    await http().post(`/empresas/${empA}/juridico/pecas/${peca}/resultado`).set(bearer(redator)).send({ resultado: 'indeferido', observacao: 'Mantido o edital' }).expect(204);
    const d = (await http().get(`/empresas/${empA}/juridico/pecas/${peca}`).set(bearer(leitor)).expect(200)).body as { status: string; resultado: string; protocoloNumero: string };
    expect([d.status, d.resultado, d.protocoloNumero]).toEqual(['respondida', 'indeferido', '2026/1']);
    const dl = await http().post(`/empresas/${empA}/juridico/pecas/${peca}/download`).set(bearer(leitor)).send({ formato: 'pdf' });
    expect(dl.status).toBe(404); // final sem PDF ainda
    await http().post(`/empresas/${empA}/juridico/pecas/${peca}/pdf`).set(bearer(leitor)).expect(202);
  });

  it('minuta pela IA: só enfileira, uma por vez, limite diário, só elaborador; o rascunho editado vira "ia_revisada"', async () => {
    const nova = ((await http().post(`/empresas/${empA}/juridico/acompanhamentos/${acomp}/pecas`).set(bearer(redator)).send({ tipo: 'esclarecimento', titulo: 'Esclarecimento sobre a marca' }).expect(201)).body as { id: string }).id;
    await http().post(`/empresas/${empA}/juridico/pecas/${nova}/minuta-ia`).set(bearer(leitor)).send({}).expect(404); // só visualizar
    const r = await http().post(`/empresas/${empA}/juridico/pecas/${nova}/minuta-ia`).set(bearer(redator)).send({ instrucao: 'Foque na cláusula 7.2' }).expect(202);
    expect((r.body as { status: string }).status).toBe('pendente');
    expect((await admin.query<{ n: string }>(`select count(*) n from ops.jobs where tipo = 'minutar_peca' and empresa_id = $1`, [empA])).rows[0]?.n).toBe('1'); // a API não chama a IA
    await http().post(`/empresas/${empA}/juridico/pecas/${nova}/minuta-ia`).set(bearer(redator)).send({}).expect(400); // já há uma em andamento
    const lista = (await http().get(`/empresas/${empA}/juridico/pecas/${nova}/minuta-ia`).set(bearer(leitor)).expect(200)).body as { status: string }[];
    expect(lista.map((x) => x.status)).toEqual(['pendente']);
    // o worker (simulado) grava o rascunho da IA; a pessoa que edita passa a ser a autora e fica registrado que nasceu da IA
    await admin.query(`update priv.pecas set minuta = 'Rascunho da IA com mais de trinta caracteres.', minuta_origem = 'ia', minuta_modelo = 'falso-1' where id = $1`, [nova]);
    await admin.query(`update priv.pecas_ia set status = 'concluida' where peca_id = $1`, [nova]);
    expect(((await http().get(`/empresas/${empA}/juridico/pecas/${nova}`).set(bearer(leitor)).expect(200)).body as { minutaOrigem: string }).minutaOrigem).toBe('ia');
    await http().put(`/empresas/${empA}/juridico/pecas/${nova}/minuta`).set(bearer(redator)).send({ minuta: 'Texto revisado pela advogada com mais de trinta caracteres.', clausulas: 'Cláusula 7.2' }).expect(202);
    expect(((await http().get(`/empresas/${empA}/juridico/pecas/${nova}`).set(bearer(leitor)).expect(200)).body as { minutaOrigem: string }).minutaOrigem).toBe('ia_revisada');
    // limite diário (controle de custo): 5 pedidos por peça
    await admin.query(`insert into priv.pecas_ia (empresa_id, peca_id, status) select $1, $2, 'concluida' from generate_series(1, 4)`, [empA, nova]);
    await http().post(`/empresas/${empA}/juridico/pecas/${nova}/minuta-ia`).set(bearer(redator)).send({}).expect(429);
    // B não vê nem pede minuta de A
    await http().post(`/empresas/${empA}/juridico/pecas/${nova}/minuta-ia`).set(bearer(b)).send({}).expect(404);
    await http().get(`/empresas/${empA}/juridico/pecas/${nova}/minuta-ia`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empB}/juridico/pecas/${nova}/minuta-ia`).set(bearer(b)).send({}).expect(404);
  });

  it('recurso de terceiro: lança o prazo de contrarrazões, abre a peça, alegação sem prova é risco, A x B', async () => {
    const texto = 'A recorrente alega que a proposta vencedora descumpre a cláusula 7.2 do edital e que a habilitação é irregular.';
    await http().post(`/empresas/${empA}/juridico/acompanhamentos/${acomp}/recursos`).set(bearer(leitor)).send({ recorrente: 'Concorrente S/A', publicadoEm: '2026-11-10T12:00:00-03:00', texto }).expect(404); // só visualizar
    await http().post(`/empresas/${empA}/juridico/acompanhamentos/${acomp}/recursos`).set(bearer(redator)).send({ recorrente: 'Concorrente S/A', publicadoEm: '2026-11-10T12:00:00-03:00', texto: 'curto' }).expect(400);
    const ins = (await http().post(`/empresas/${empA}/juridico/acompanhamentos/${acomp}/recursos`).set(bearer(redator)).send({ recorrente: 'Concorrente S/A', publicadoEm: '2026-11-10T12:00:00-03:00', texto, link: 'https://exemplo.gov.br/recurso.pdf' }).expect(201)).body as { id: string; pecaId: string; eventoId: string };
    expect((await admin.query<{ n: string }>(`select count(*) n from ops.jobs where tipo = 'ler_recurso' and empresa_id = $1`, [empA])).rows[0]?.n).toBe('1'); // a API não chama a IA
    const pc = (await http().get(`/empresas/${empA}/juridico/pecas/${ins.pecaId}`).set(bearer(leitor)).expect(200)).body as { tipo: string; status: string; eventoId: string };
    expect([pc.tipo, pc.status, pc.eventoId]).toEqual(['contrarrazoes', 'triagem', ins.eventoId]);
    const al = ((await http().post(`/empresas/${empA}/juridico/recursos/${ins.id}/alegacoes`).set(bearer(redator)).send({ resumo: 'Proposta descumpre a cláusula 7.2', citacao: 'descumpre a cláusula 7.2 do edital' }).expect(201)).body as { id: string }).id;
    let d = (await http().get(`/empresas/${empA}/juridico/recursos/${ins.id}`).set(bearer(leitor)).expect(200)).body as { leituraStatus: string; alegacoes: { risco: boolean; citacaoConfere: boolean }[] };
    expect([d.leituraStatus, d.alegacoes[0]?.risco, d.alegacoes[0]?.citacaoConfere]).toEqual(['pendente', true, true]);
    await http().put(`/empresas/${empA}/juridico/alegacoes/${al}`).set(bearer(leitor)).send({ decisao: 'rebater' }).expect(404);
    await http().put(`/empresas/${empA}/juridico/alegacoes/${al}`).set(bearer(redator)).send({ decisao: 'rebater', contraProva: 'Ficha técnica, p. 3', fundamento: 'cláusula 7.2' }).expect(204);
    d = (await http().get(`/empresas/${empA}/juridico/recursos/${ins.id}`).set(bearer(leitor)).expect(200)).body as typeof d;
    expect(d.alegacoes[0]?.risco).toBe(false);
    const lista = (await http().get(`/empresas/${empA}/juridico/recursos?acompanhamento=${acomp}`).set(bearer(leitor)).expect(200)).body as { id: string; alegacoes: number; riscos: number }[];
    expect(lista.map((x) => [x.id, x.alegacoes, x.riscos])).toEqual([[ins.id, 1, 0]]);
    await http().post(`/empresas/${empA}/juridico/recursos/${ins.id}/ler`).set(bearer(leitor)).expect(404);
    // B não vê nem altera nada
    await http().get(`/empresas/${empA}/juridico/recursos/${ins.id}`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empB}/juridico/recursos/${ins.id}`).set(bearer(b)).expect(404);
    expect(((await http().get(`/empresas/${empB}/juridico/recursos`).set(bearer(b)).expect(200)).body as unknown[])).toHaveLength(0);
    await http().post(`/empresas/${empA}/juridico/recursos/${ins.id}/ler`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/juridico/recursos/${ins.id}/alegacoes`).set(bearer(b)).send({ resumo: 'Invasor' }).expect(404);
    await http().put(`/empresas/${empA}/juridico/alegacoes/${al}`).set(bearer(b)).send({ decisao: 'concordar' }).expect(404);
    await http().delete(`/empresas/${empA}/juridico/alegacoes/${al}`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empB}/juridico/recursos/${ins.id}/ler`).set(bearer(b)).expect(404);
    await http().put(`/empresas/${empB}/juridico/alegacoes/${al}`).set(bearer(b)).send({ decisao: 'concordar' }).expect(404); // a função do banco não acha a alegação em B
    // limite diário de leituras (custo)
    await admin.query(`update priv.recursos_terceiros set leitura_dia = current_date, leitura_qtd = 5 where id = $1`, [ins.id]);
    await http().post(`/empresas/${empA}/juridico/recursos/${ins.id}/ler`).set(bearer(redator)).expect(429);
    await http().delete(`/empresas/${empA}/juridico/alegacoes/${al}`).set(bearer(redator)).expect(204);
  });

  it('A x B: B não lê nem altera nada do jurídico de A', async () => {
    await http().get(`/empresas/${empA}/juridico/base`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empA}/juridico/pecas`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empA}/juridico/pecas/${peca}`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/juridico/acompanhamentos/${acomp}/pecas`).set(bearer(b)).send({ tipo: 'recurso', titulo: 'Invasor' }).expect(404);
    for (const acao of ['descartar', 'revisao', 'devolver', 'aprovar', 'protocolo', 'resultado', 'pdf', 'download', 'validar']) {
      await http().post(`/empresas/${empA}/juridico/pecas/${peca}/${acao}`).set(bearer(b)).send({}).expect(404);
    }
    await http().post(`/empresas/${empA}/juridico/base/${base165}/verificar`).set(bearer(b)).expect(404);
    await http().delete(`/empresas/${empA}/juridico/base/${base165}`).set(bearer(b)).expect(404);
    // empresa de B na rota com ids de A: nada é encontrado nem revelado
    await http().get(`/empresas/${empB}/juridico/pecas/${peca}`).set(bearer(b)).expect(404);
    expect(((await http().get(`/empresas/${empB}/juridico/pecas`).set(bearer(b)).expect(200)).body as unknown[])).toHaveLength(0);
    await http().post(`/empresas/${empB}/juridico/pecas/${peca}/download`).set(bearer(b)).send({}).expect(404);
    await http().post(`/empresas/${empB}/juridico/pecas/${peca}/aprovar`).set(bearer(b)).expect(400);
  });
  for (const dona of ['A', 'B'] as const) {
    it(`isolamento por endpoint: peças e base de ${dona} intactas nas 19 rotas`, async () => {
      const empresa = dona === 'A' ? empA : empB;
      const outra = dona === 'A' ? empB : empA;
      const token = dona === 'A' ? a : b;
      const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) select e.fonte_id, $2, e.orgao_id, $2, e.hash_conteudo from pub.editais e join priv.acompanhamentos a on a.edital_id = e.id where a.id = $1 returning id`, [acomp, crypto.randomUUID()])).rows[0]?.id ?? '';
      const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empresa, edital])).rows[0]?.id ?? '';
      const raiz = `/empresas/${empresa}/juridico`;
      const baseDados = { tipo: 'lei', numero: '999/FICTICIA', titulo: 'Fonte fictícia da matriz', linkOficial: 'https://exemplo.gov.br/matriz' };
      const baseId = ((await http().post(`${raiz}/base`).set(bearer(token)).send(baseDados).expect(201)).body as { id: string }).id;
      const id = ((await http().post(`${raiz}/acompanhamentos/${ac}/pecas`).set(bearer(token)).send({ tipo: 'impugnacao', titulo: 'Peça fictícia da matriz' }).expect(201)).body as { id: string }).id;
      // Simula o worker: o download precisa negar também uma peça com arquivo final.
      const final = (await admin.query<{ id: string }>(`insert into priv.pecas (empresa_id, acompanhamento_id, tipo, titulo) values ($1, $2, 'recurso', 'Final fictício') returning id`, [empresa, ac])).rows[0]?.id ?? '';
      await admin.query(`update priv.pecas set status = 'final', arquivo_chave = 'pecas/matriz.docx', arquivo_pdf_chave = 'pecas/matriz.pdf', arquivo_sha256 = repeat('d', 64), gerado_em = now() where id = $1`, [final]);
      const snapshot = async () => (await admin.query<Record<string, unknown>>(`select (select jsonb_agg(p order by p.id) from priv.pecas p where acompanhamento_id = $1) as pecas, (select to_jsonb(b) from priv.base_juridica b where id = $2) as base, (select jsonb_agg(i order by i.id) from priv.pecas_ia i where peca_id in ($3, $4)) as ia`, [ac, baseId, id, final])).rows;
      await admin.query(`insert into priv.pecas_ia (empresa_id, peca_id, status) values ($1, $2, 'concluida')`, [empresa, id]);
      const antes = await snapshot();
      const jobs = async () => (await admin.query<{ id: string }>(`select id from ops.jobs where tipo in ('minutar_peca', 'processar_peca', 'ler_recurso', 'analisar_vencedora', 'sugerir_pecas', 'validar_tese', 'validar_parecer') and empresa_id in ($1, $2) order by id`, [empresa, outra])).rows;
      const jobsAntes = await jobs();
      for (const e of [empresa, outra]) {
        const su = await stepUp(app, dona === 'A' ? b : a, 'aprovar_peca');
        if (dona === 'A') b = su.token; else a = su.token;
        const invasor = su.token;
        const r = `/empresas/${e}/juridico`;
        for (const path of ['base', `pecas?acompanhamento=${ac}`]) {
          const resp = await http().get(`${r}/${path}`).set(bearer(invasor)).expect(e === empresa ? 404 : 200);
          if (e === outra) expect(resp.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: baseId })]));
          if (e === outra) expect(resp.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
        }
        await http().post(`${r}/base`).set(bearer(invasor)).send(baseDados).expect(e === empresa ? 404 : 201);
        // Criar na própria empresa é permitido; jamais verificar/apagar a fonte alheia.
        await http().post(`${r}/base/${baseId}/verificar`).set(bearer(invasor)).expect(404);
        await http().delete(`${r}/base/${baseId}`).set(bearer(invasor)).expect(404);
        await http().post(`${r}/acompanhamentos/${ac}/pecas`).set(bearer(invasor)).send({ tipo: 'recurso', titulo: 'Invasão fictícia' }).expect(404);
        await http().get(`${r}/pecas/${id}`).set(bearer(invasor)).expect(404);
        const historico = await http().get(`${r}/pecas/${id}/minuta-ia`).set(bearer(invasor)).expect(e === empresa ? 404 : 200);
        if (e === outra) expect(historico.body).toEqual([]);
        await http().put(`${r}/pecas/${id}/minuta`).set(bearer(invasor)).send({ minuta: 'Texto fictício de tentativa de alteração.' }).expect(e === empresa ? 404 : 400);
        for (const [acao, corpo] of [
          ['descartar', { justificativa: 'Tentativa fictícia de descarte' }], ['minuta-ia', {}], ['validar', {}], ['revisao', {}], ['devolver', {}],
          ['aprovar', { stepUp: su.id }], ['protocolo', { numero: '2026/99', quando: '2026-11-10T10:00:00-03:00' }], ['resultado', { resultado: 'deferido' }], ['pdf', {}],
        ] as const) {
          // Funções de fluxo usam 400 também para ID inexistente; não revelam a peça.
          const status = e === outra && ['descartar', 'revisao', 'devolver', 'aprovar', 'protocolo', 'resultado'].includes(acao) ? 400 : 404;
          await http().post(`${r}/pecas/${id}/${acao}`).set(bearer(invasor)).send(corpo).expect(status);
        }
        for (const formato of ['docx', 'pdf']) {
          const dl = await http().post(`${r}/pecas/${final}/download`).set(bearer(invasor)).send({ formato }).expect(404);
          expect(dl.body).not.toHaveProperty('url');
        }
        expect(await snapshot()).toEqual(antes);
        expect(await jobs()).toEqual(jobsAntes);
      }
    });
  }

});
