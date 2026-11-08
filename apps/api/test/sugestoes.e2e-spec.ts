import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Sugestões de esclarecimento e impugnação da Fase 10 (10.2/10.3): pedido só enfileira, aceitar abre a peça ligada ao prazo, intempestiva, descarte e A x B.
describe('sugestões de peças: fluxo e A x B', () => {
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

  let empA: string; let empB: string; let redator: string; let leitor: string;
  let acomp: string; let sug: string; let sugImp: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Sugestão A'); empB = await criarEmpresa('Sugestão B');
    const [eA, eB, eR, eL] = await Promise.all([criarUsuario('su-a'), criarUsuario('su-b'), criarUsuario('su-r'), criarUsuario('su-l')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eR, empA, 'JURIDICO', ['juridico:visualizar', 'juridico:elaborar_peca', 'agenda:visualizar']);
    await vincular(eL, empA, 'OPERADOR', ['juridico:visualizar', 'agenda:visualizar']);
    [, , redator, leitor] = await Promise.all([entrar(eA), entrar(eB), entrar(eR), entrar(eL)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'` )).rows[0]?.id ?? '';
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Sugestão', 'PR', '4106902') returning id`, [cnpjFicticio()] )).rows[0]?.id ?? '';
    const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values ($1, $2, $3, '3/2026', 'Objeto', repeat('1', 64)) returning id`, [fonte, `SU-${crypto.randomUUID()}`, orgao] )).rows[0]?.id ?? '';
    acomp = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empA, edital])).rows[0]?.id ?? '';
    await admin.query(`insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, data_limite_legal) values ($1, $2, 'esclarecimento', now() + interval '5 days'), ($1, $2, 'impugnacao', now() - interval '1 day')`, [empA, acomp]);
    sug = (await admin.query<{ id: string }>(`insert into priv.sugestoes_pecas (empresa_id, acompanhamento_id, tipo, titulo, duvida, trecho_edital, trecho_confere, pagina) values ($1, $2, 'esclarecimento', 'Dúvida sobre a marca', 'O edital exige marca específica?', 'marca XPTO modelo 9', true, 3) returning id`, [empA, acomp])).rows[0]?.id ?? '';
    sugImp = (await admin.query<{ id: string }>(`insert into priv.sugestoes_pecas (empresa_id, acompanhamento_id, tipo, titulo, duvida, status) values ($1, $2, 'impugnacao', 'Direcionamento de marca', 'Cláusula 7.2 direciona', 'nova') returning id`, [empA, acomp])).rows[0]?.id ?? '';
  });
  afterAll(async () => {
    await app.close();
  });

  it('pedir só enfileira; limite; aceitar abre a peça ligada ao prazo; prazo vencido não aceita; descarte justificado', async () => {
    const base = `/empresas/${empA}/juridico`;
    await http().post(`${base}/acompanhamentos/${acomp}/sugestoes`).set(bearer(leitor)).expect(404); // só visualizar
    await http().post(`${base}/acompanhamentos/${acomp}/sugestoes`).set(bearer(redator)).expect(202);
    expect((await admin.query<{ n: string }>(`select count(*) n from ops.jobs where tipo = 'sugerir_pecas' and empresa_id = $1`, [empA])).rows[0]?.n).toBe('1'); // a API não chama a IA
    await http().post(`${base}/acompanhamentos/${acomp}/sugestoes`).set(bearer(redator)).expect(400); // já há uma busca em andamento
    await admin.query(`update priv.sugestoes_execucoes set status = 'concluida'`);
    await admin.query(`insert into priv.sugestoes_execucoes (empresa_id, acompanhamento_id, status) select $1, $2, 'concluida' from generate_series(1, 2)`, [empA, acomp]);
    await http().post(`${base}/acompanhamentos/${acomp}/sugestoes`).set(bearer(redator)).expect(429);
    const l = (await http().get(`${base}/sugestoes`).set(bearer(leitor)).expect(200)).body as { sugestoes: { id: string; status: string; tipo: string }[]; execucoes: { status: string }[] };
    expect(l.sugestoes.map((s) => [s.id, s.status]).sort()).toEqual([[sug, 'nova'], [sugImp, 'nova']].sort());
    expect(l.execucoes).toHaveLength(1);
    await http().post(`${base}/sugestoes/${sug}/aceitar`).set(bearer(leitor)).expect(404);
    const peca = ((await http().post(`${base}/sugestoes/${sug}/aceitar`).set(bearer(redator)).expect(201)).body as { pecaId: string }).pecaId;
    const pc = (await http().get(`${base}/pecas/${peca}`).set(bearer(leitor)).expect(200)).body as { tipo: string; status: string; prazoLegal: string | null };
    expect([pc.tipo, pc.status, pc.prazoLegal !== null]).toEqual(['esclarecimento', 'triagem', true]); // ligada ao prazo da agenda
    await http().post(`${base}/sugestoes/${sug}/aceitar`).set(bearer(redator)).expect(400); // só uma vez
    await http().post(`${base}/sugestoes/${sugImp}/aceitar`).set(bearer(redator)).expect(400); // prazo de impugnação vencido (intempestiva)
    await http().post(`${base}/sugestoes/${sugImp}/descartar`).set(bearer(redator)).send({ justificativa: 'curta' }).expect(400);
    await http().post(`${base}/sugestoes/${sugImp}/descartar`).set(bearer(redator)).send({ justificativa: 'Prazo de impugnação já venceu, não cabe mais' }).expect(204);
    const depois = (await http().get(`${base}/sugestoes`).set(bearer(leitor)).expect(200)).body as { sugestoes: { id: string; status: string }[] };
    expect(depois.sugestoes.find((s) => s.id === sugImp)?.status).toBe('descartada');
  });


  for (const sentido of ['B → A', 'A → B']) {
    it(`matriz A x B por endpoint: ${sentido}`, async () => {
      const empresa = await criarEmpresa('Dona ' + sentido);
      const outra = await criarEmpresa('Invasora ' + sentido);
      const donoEmail = await criarUsuario('mat-dono');
      const email = await criarUsuario('mat-invasor');
      await vincular(donoEmail, empresa); await vincular(email, outra);
      const dono = await entrar(donoEmail); const invasor = await entrar(email);
      const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'` )).rows[0]?.id ?? '';
      const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Matriz', 'PR', '4106902') returning id`, [cnpjFicticio()] )).rows[0]?.id ?? '';
      const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values ($1, $2, $3, '8/2026', 'Objeto fictício', repeat('1', 64)) returning id`, [fonte, crypto.randomUUID(), orgao] )).rows[0]?.id ?? '';
      const acompanhamento = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empresa, edital] )).rows[0]?.id ?? '';
      const raiz = `/empresas/${empresa}/juridico`;

      await admin.query(`insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, data_limite_legal) values ($1, $2, 'esclarecimento', now() + interval '5 days')`, [empresa, acompanhamento]);
      const id = (await admin.query<{ id: string }>(`insert into priv.sugestoes_pecas (empresa_id, acompanhamento_id, tipo, titulo, duvida, trecho_edital, trecho_confere) values ($1, $2, 'esclarecimento', 'Sugestão privada', 'Dúvida fictícia', 'Trecho fictício', true) returning id`, [empresa, acompanhamento] )).rows[0]?.id ?? '';
      await http().post(`${raiz}/acompanhamentos/${acompanhamento}/sugestoes`).set(bearer(dono)).expect(202);
      const snapshot = async () => (await admin.query<Record<string, unknown>>(`select
        (select jsonb_agg(s order by id) from priv.sugestoes_pecas s where empresa_id in ($1,$2)) sugestoes,
        (select jsonb_agg(s order by id) from priv.sugestoes_execucoes s where empresa_id in ($1,$2)) execucoes,
        (select jsonb_agg(p order by id) from priv.pecas p where empresa_id in ($1,$2)) pecas,
        (select jsonb_agg(j order by id) from ops.jobs j where empresa_id in ($1,$2) and tipo = 'sugerir_pecas') jobs`, [empresa, outra])).rows;
      const antes = await snapshot();
      for (const e of [empresa, outra]) {
        const base = `/empresas/${e}/juridico`;
        const lista = await http().get(`${base}/sugestoes`).set(bearer(invasor)).expect(e === empresa ? 404 : 200);
        if (e === outra) expect(lista.body).toEqual({ sugestoes: [], execucoes: [] });
        expect(await snapshot()).toEqual(antes);
        for (const path of [`/acompanhamentos/${acompanhamento}/sugestoes`, `/sugestoes/${id}/aceitar`, `/sugestoes/${id}/descartar`]) {
          const corpo = { justificativa: 'Tentativa fictícia de descarte' };
          const esperado = e === outra && path.endsWith('/descartar') ? 400 : 404;
          const r = await http().post(base + path).set(bearer(invasor)).send(corpo).expect(esperado);
          if (esperado === 400) {
            // Ausência e estado inválido compartilham 22023; não distingue ID alheio.
            const vazio = await http().post(`${base}/sugestoes/${crypto.randomUUID()}/descartar`).set(bearer(invasor)).send(corpo).expect(400);
            expect(r.body).toEqual(vazio.body);
          }
          expect(await snapshot(), path).toEqual(antes);
        }
      }
    });
  }
});
