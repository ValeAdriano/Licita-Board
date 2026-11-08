import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Parecer de viabilidade recursal da Fase 10 (10.4/10.5): gatilho, achados, recomendação, evidência conferida pelo worker, peça de recurso e A x B.
describe('parecer recursal: fluxo e A x B', () => {
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

  let empA: string; let empB: string; let a: string; let b: string; let redator: string; let leitor: string;
  let acomp: string; let part: string; let parecer: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Parecer A'); empB = await criarEmpresa('Parecer B');
    const [eA, eB, eR, eL] = await Promise.all([criarUsuario('pa-a'), criarUsuario('pa-b'), criarUsuario('pa-r'), criarUsuario('pa-l')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eR, empA, 'JURIDICO', ['juridico:visualizar', 'juridico:elaborar_peca', 'agenda:visualizar']);
    await vincular(eL, empA, 'OPERADOR', ['juridico:visualizar', 'agenda:visualizar']);
    [a, b, redator, leitor] = await Promise.all([entrar(eA), entrar(eB), entrar(eR), entrar(eL)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Parecer', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values ($1, $2, $3, '3/2026', 'Objeto', repeat('1', 64)) returning id`, [fonte, `PA-${crypto.randomUUID()}`, orgao])).rows[0]?.id;
    acomp = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empA, edital])).rows[0]?.id ?? '';
    const item = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao) values ($1, 1, 'Veículo utilitário') returning id`, [edital])).rows[0]?.id;
    part = (await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values ($1, $2, $3) returning id`, [empA, acomp, item])).rows[0]?.id ?? '';
  });
  afterAll(async () => {
    await app.close();
  });

  it('só abre parecer quando a empresa não foi a primeira colocada; achados, recomendação humana e conferência da evidência', async () => {
    const b0 = `/empresas/${empA}/juridico/pareceres`;
    await http().post(`${b0}/participacao/${part}`).set(bearer(redator)).send({ concorrente: 'Concorrente S/A' }).expect(400); // ainda sem resultado com gatilho
    await admin.query(`insert into priv.resultados_item (empresa_id, participacao_id, resultado_final, motivo_perda, gatilho_recursal) values ($1, $2, 'perdida', 'Perdeu no lance', true)`, [empA, part]);
    await http().post(`${b0}/participacao/${part}`).set(bearer(leitor)).send({ concorrente: 'Concorrente S/A' }).expect(404); // só visualizar
    parecer = ((await http().post(`${b0}/participacao/${part}`).set(bearer(redator)).send({ concorrente: 'Concorrente S/A', texto: 'Proposta da concorrente: certidão negativa vencida em 01/10/2026 e marca XPTO.' }).expect(201)).body as { id: string }).id;
    const lista = (await http().get(b0).set(bearer(leitor)).expect(200)).body as { participacaoId: string; parecerId: string }[];
    expect(lista.map((x) => [x.participacaoId, x.parecerId])).toEqual([[part, parecer]]);
    const ach = ((await http().post(`${b0}/${parecer}/achados`).set(bearer(redator)).send({ tipo: 'certidao', descricao: 'Certidão vencida na sessão', citacaoConcorrente: 'certidão negativa vencida em 01/10/2026', classificacao: 'forte' }).expect(201)).body as { id: string }).id;
    await http().put(`${b0}/${parecer}/achados/${ach}`).set(bearer(redator)).send({ tipo: 'certidao', descricao: 'Certidão vencida na sessão', prova: 'Certidão, p. 2', fundamento: 'Lei 14.133/2021, art. 165', classificacao: 'forte' }).expect(204);
    expect((await admin.query<{ n: string }>(`select count(*) n from ops.jobs where tipo = 'validar_parecer' and empresa_id = $1`, [empA])).rows[0]?.n).toBe('3'); // a API não confere nada
    await http().put(`${b0}/${parecer}/recomendacao`).set(bearer(redator)).send({ recomendacao: 'recorrer', justificativa: 'Certidão vencida comprovada pela proposta' }).expect(404); // recomendar é de quem aprova
    await http().put(`${b0}/${parecer}/recomendacao`).set(bearer(a)).send({ recomendacao: 'recorrer', justificativa: 'curta' }).expect(400);
    await http().put(`${b0}/${parecer}/recomendacao`).set(bearer(a)).send({ recomendacao: 'recorrer', justificativa: 'Certidão vencida comprovada pela proposta' }).expect(204);
    await http().post(`${b0}/${parecer}/recurso`).set(bearer(redator)).expect(400); // evidência ainda não conferida pelo worker
    await admin.query(`update priv.pareceres_recursais set validacao = '[]'::jsonb, validada_em = now(), bloqueado = false where id = $1`, [parecer]); // o worker faria isto
    const peca = ((await http().post(`${b0}/${parecer}/recurso`).set(bearer(redator)).expect(201)).body as { pecaId: string }).pecaId;
    await http().post(`${b0}/${parecer}/recurso`).set(bearer(redator)).expect(400); // só uma vez
    const pc = (await http().get(`/empresas/${empA}/juridico/pecas/${peca}`).set(bearer(leitor)).expect(200)).body as { tipo: string; status: string };
    expect([pc.tipo, pc.status]).toEqual(['recurso', 'triagem']);
    const d = (await http().get(`${b0}/participacao/${part}`).set(bearer(leitor)).expect(200)).body as { parecer: { pecaId: string; recomendacao: string }; achados: { classificacao: string }[] };
    expect([d.parecer.pecaId, d.parecer.recomendacao, d.achados[0]?.classificacao]).toEqual([peca, 'recorrer', 'forte']);
  });

  it('análise da vencedora pela IA: só enfileira, limite diário, remover achado; A x B', async () => {
    const b0 = `/empresas/${empA}/juridico/pareceres`;
    await http().post(`${b0}/${parecer}/analisar`).set(bearer(leitor)).expect(404);
    await http().post(`${b0}/${parecer}/analisar`).set(bearer(redator)).expect(202);
    expect((await admin.query<{ n: string }>(`select count(*) n from ops.jobs where tipo = 'analisar_vencedora' and empresa_id = $1`, [empA])).rows[0]?.n).toBe('1'); // a API não chama a IA
    await admin.query(`update priv.pareceres_recursais set analise_dia = current_date, analise_qtd = 3 where id = $1`, [parecer]);
    await http().post(`${b0}/${parecer}/analisar`).set(bearer(redator)).expect(429);
    const ach = (await admin.query<{ id: string }>(`select id from priv.parecer_achados where parecer_id = $1`, [parecer])).rows[0]?.id ?? '';
    // B não vê nem altera nada de A
    await http().get(b0).set(bearer(b)).expect(404);
    await http().get(`${b0}/participacao/${part}`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empB}/juridico/pareceres/participacao/${part}`).set(bearer(b)).expect(404);
    expect(((await http().get(`/empresas/${empB}/juridico/pareceres`).set(bearer(b)).expect(200)).body as unknown[])).toHaveLength(0);
    await http().post(`${b0}/participacao/${part}`).set(bearer(b)).send({ concorrente: 'Invasor' }).expect(404);
    await http().post(`${b0}/${parecer}/analisar`).set(bearer(b)).expect(404);
    await http().post(`${b0}/${parecer}/achados`).set(bearer(b)).send({ tipo: 'outro', descricao: 'Invasor' }).expect(404);
    await http().put(`${b0}/${parecer}/recomendacao`).set(bearer(b)).send({ recomendacao: 'nao_recorrer', justificativa: 'Tentativa de invasão' }).expect(404);
    await http().delete(`${b0}/achados/${ach}`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empB}/juridico/pareceres/${parecer}/analisar`).set(bearer(b)).expect(404);
    await http().delete(`${b0}/achados/${ach}`).set(bearer(leitor)).expect(404);
    await http().delete(`${b0}/achados/${ach}`).set(bearer(redator)).expect(204);
  });
  for (const sentido of ['A → B', 'B → A']) {
    it(`isolamento por endpoint: pareceres ${sentido}, nove rotas sem efeitos`, async () => {
      // Empresas, usuários e edital exclusivos deste caso: nenhuma dependência da ordem das suítes.
      const empresa = await criarEmpresa(`Parecer dona ${sentido}`);
      const outra = await criarEmpresa(`Parecer invasora ${sentido}`);
      const email = await criarUsuario('matriz-parecer-dona');
      const invasorEmail = await criarUsuario('matriz-parecer-invasor');
      await vincular(email, empresa); await vincular(invasorEmail, outra);
      const token = await entrar(email); const invasor = await entrar(invasorEmail);
      const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) select e.fonte_id, $2, e.orgao_id, $2, e.hash_conteudo from pub.editais e join priv.acompanhamentos a on a.edital_id = e.id where a.id = $1 returning id`, [acomp, crypto.randomUUID()])).rows[0]?.id ?? '';
      const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empresa, edital])).rows[0]?.id ?? '';
      const item = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao) values ($1, 1, 'Item fictício da matriz') returning id`, [edital])).rows[0]?.id;
      const participacao = (await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values ($1, $2, $3) returning id`, [empresa, ac, item])).rows[0]?.id ?? '';
      await admin.query(`insert into priv.resultados_item (empresa_id, participacao_id, resultado_final, motivo_perda, gatilho_recursal) values ($1, $2, 'perdida', 'Resultado fictício', true)`, [empresa, participacao]);
      const raiz = `/empresas/${empresa}/juridico/pareceres`;
      const id = ((await http().post(`${raiz}/participacao/${participacao}`).set(bearer(token)).send({ concorrente: 'Concorrente fictícia' }).expect(201)).body as { id: string }).id;
      const dados = { tipo: 'outro', descricao: 'Achado fictício da matriz', prova: 'Prova fictícia', classificacao: 'moderada' };
      const achado = ((await http().post(`${raiz}/${id}/achados`).set(bearer(token)).send(dados).expect(201)).body as { id: string }).id;
      await http().put(`${raiz}/${id}/recomendacao`).set(bearer(token)).send({ recomendacao: 'recorrer', justificativa: 'Justificativa fictícia suficiente' }).expect(204);
      // Simula a conferência do worker, permitindo abrir recurso se houvesse falha de isolamento.
      await admin.query(`update priv.pareceres_recursais set validacao = '[]', validada_em = now(), bloqueado = false where id = $1`, [id]);
      const snapshot = async () => (await admin.query<Record<string, unknown>>(`select
        (select jsonb_agg(p order by p.id) from priv.pareceres_recursais p where empresa_id in ($1, $2)) pareceres,
        (select jsonb_agg(a order by a.id) from priv.parecer_achados a where empresa_id in ($1, $2)) achados,
        (select jsonb_agg(p order by p.id) from priv.pecas p where empresa_id in ($1, $2)) pecas,
        (select jsonb_agg(j order by j.id) from ops.jobs j where empresa_id in ($1, $2) and tipo in ('validar_parecer', 'analisar_vencedora')) jobs`, [empresa, outra])).rows;
      const antes = await snapshot();
      for (const e of [empresa, outra]) {
        const base = `/empresas/${e}/juridico/pareceres`;
        const lista = await http().get(base).set(bearer(invasor)).expect(e === empresa ? 404 : 200);
        if (e === outra) expect(lista.body).toEqual([]);
        expect(await snapshot()).toEqual(antes);
        const ausente = crypto.randomUUID();
        const casos = [
          { metodo: 'get', path: `/participacao/${participacao}`, vazio: `/participacao/${ausente}`, corpo: {} },
          { metodo: 'post', path: `/participacao/${participacao}`, vazio: `/participacao/${ausente}`, corpo: { concorrente: 'Invasora fictícia' } },
          { metodo: 'post', path: `/${id}/analisar`, vazio: `/${ausente}/analisar`, corpo: {} },
          { metodo: 'post', path: `/${id}/achados`, vazio: `/${ausente}/achados`, corpo: dados },
          { metodo: 'put', path: `/${id}/achados/${achado}`, vazio: `/${ausente}/achados/${ausente}`, corpo: dados },
          { metodo: 'delete', path: `/achados/${achado}`, vazio: `/achados/${ausente}`, corpo: {} },
          { metodo: 'put', path: `/${id}/recomendacao`, vazio: `/${ausente}/recomendacao`, corpo: { recomendacao: 'nao_recorrer', justificativa: 'Tentativa fictícia de alteração' } },
          { metodo: 'post', path: `/${id}/recurso`, vazio: `/${ausente}/recurso`, corpo: {} },
        ] as const;
        for (const caso of casos) {
          const resposta = await http()[caso.metodo](`${base}${caso.path}`).set(bearer(invasor)).send(caso.corpo);
          // abrir_parecer usa 22023 para participação ausente: mesma resposta para UUID inexistente.
          const esperado = e === outra && caso.metodo === 'post' && caso.path.startsWith('/participacao/') ? 400 : 404;
          expect(resposta.status, caso.path).toBe(esperado);
          if (resposta.status === 400) {
            const inexistente = await http()[caso.metodo](`${base}${caso.vazio}`).set(bearer(invasor)).send(caso.corpo).expect(400);
            expect(resposta.body, caso.path).toEqual(inexistente.body);
          }
          expect(await snapshot(), caso.path).toEqual(antes);
        }
      }
    });
  }

});
