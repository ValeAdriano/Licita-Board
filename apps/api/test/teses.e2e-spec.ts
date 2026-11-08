import { inflateRawSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Banco de teses e indicadores da Fase 10 (10.8/10.9): criar/aprovar com permissões, uso numa peça, deferimento por tese e A x B.
describe('teses e indicadores: fluxo e A x B', () => {
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

  let empA: string; let empB: string; let a: string; let redator: string; let leitor: string;
  let acomp: string; let peca: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Tese A'); empB = await criarEmpresa('Tese B');
    const [eA, eB, eR, eL] = await Promise.all([criarUsuario('te-a'), criarUsuario('te-b'), criarUsuario('te-r'), criarUsuario('te-l')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eR, empA, 'JURIDICO', ['juridico:visualizar', 'juridico:elaborar_peca', 'agenda:visualizar']);
    await vincular(eL, empA, 'OPERADOR', ['juridico:visualizar', 'agenda:visualizar']);
    [a, , redator, leitor] = await Promise.all([entrar(eA), entrar(eB), entrar(eR), entrar(eL)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'` )).rows[0]?.id ?? '';
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Tese', 'PR', '4106902') returning id`, [cnpjFicticio()] )).rows[0]?.id ?? '';
    const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values ($1, $2, $3, '3/2026', 'Objeto', repeat('1', 64)) returning id`, [fonte, `TE-${crypto.randomUUID()}`, orgao] )).rows[0]?.id ?? '';
    acomp = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1, $2) returning id`, [empA, edital])).rows[0]?.id ?? '';
    peca = (await admin.query<{ id: string }>(`insert into priv.pecas (empresa_id, acompanhamento_id, tipo, titulo) values ($1, $2, 'impugnacao', 'Impugnação ao item 3') returning id`, [empA, acomp])).rows[0]?.id ?? '';
  });
  afterAll(async () => {
    await app.close();
  });

  it('tese: criar (elaborar), aprovar só após a conferência e por quem aprova; usar só aprovada; indicadores por tese', async () => {
    const base = `/empresas/${empA}/juridico`;
    const nova = { tipo: 'impugnacao', titulo: 'Marca única', texto: 'A exigência de marca específica sem justificativa restringe a competitividade, conforme o art. 165.' };
    await http().post(`${base}/teses`).set(bearer(leitor)).send(nova).expect(404); // só visualizar
    await http().post(`${base}/teses`).set(bearer(redator)).send({ ...nova, texto: 'curta' }).expect(400);
    const tese = ((await http().post(`${base}/teses`).set(bearer(redator)).send(nova).expect(201)).body as { id: string }).id;
    expect((await admin.query<{ n: string }>(`select count(*) n from ops.jobs where tipo = 'validar_tese' and empresa_id = $1`, [empA])).rows[0]?.n).toBe('1'); // a API não confere citações
    await http().post(`${base}/teses/${tese}/aprovar`).set(bearer(redator)).expect(404); // aprovar é de quem aprova peças
    await http().post(`${base}/teses/${tese}/aprovar`).set(bearer(a)).expect(400); // o worker ainda não conferiu
    await http().post(`${base}/pecas/${peca}/teses/${tese}`).set(bearer(redator)).expect(400); // rascunho não se usa
    await admin.query(`update priv.teses set validada_em = now(), bloqueada = false where id = $1`, [tese]); // o worker faria isto
    await http().post(`${base}/teses/${tese}/aprovar`).set(bearer(a)).expect(204);
    const das = (await http().get(`${base}/pecas/${peca}/teses`).set(bearer(leitor)).expect(200)).body as { id: string; usada: boolean }[];
    expect(das.map((t) => [t.id, t.usada])).toEqual([[tese, false]]);
    await http().post(`${base}/pecas/${peca}/teses/${tese}`).set(bearer(leitor)).expect(404);
    await http().post(`${base}/pecas/${peca}/teses/${tese}`).set(bearer(redator)).expect(204);
    await http().post(`${base}/pecas/${peca}/teses/${tese}`).set(bearer(redator)).expect(204); // idempotente
    // a peça foi protocolada e deferida: a tese soma um uso e um deferimento
    await admin.query(`update priv.pecas set status = 'respondida', resultado = 'deferido', protocolo_numero = '1/2026', protocolado_em = now() where id = $1`, [peca]);
    const lista = (await http().get(`${base}/teses`).set(bearer(leitor)).expect(200)).body as { id: string; usos: number; respondidas: number; deferidas: number }[];
    expect(lista.map((t) => [t.id, t.usos, t.respondidas, t.deferidas])).toEqual([[tese, 1, 1, 1]]);
    const ind = (await http().get(`${base}/indicadores`).set(bearer(leitor)).expect(200)).body as { elaboradas: number; protocoladas: number; respondidas: number; deferidas: number; porTipo: { tipo: string; taxa: string | null }[]; porTese: { id: string; taxa: string | null }[] };
    expect([ind.elaboradas, ind.protocoladas, ind.respondidas, ind.deferidas]).toEqual([1, 1, 1, 1]);
    expect(ind.porTipo.find((t) => t.tipo === 'impugnacao')?.taxa).toBe('100.0');
    expect(ind.porTese.map((t) => [t.id, t.taxa])).toEqual([[tese, '100.0']]);
    await http().get(`${base}/indicadores?ano=2001`).set(bearer(leitor)).expect(200);
    // Excel dos indicadores: exige juridico/exportar (leitor e redator não têm), o administrador baixa um pacote .xlsx
    await http().get(`${base}/indicadores.xlsx`).set(bearer(leitor)).expect(404);
    const xl = (await http().get(`${base}/indicadores.xlsx`).set(bearer(a)).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => { cb(null, Buffer.concat(c)); }); }).expect(200));
    expect(xl.headers['content-type']).toContain('spreadsheetml.sheet');
    expect((xl.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    await http().put(`${base}/teses/${tese}`).set(bearer(redator)).send({ titulo: 'Marca única (revisada)', texto: 'Texto revisado do argumento, sem citar lei, só a competitividade.' }).expect(204);
    expect(((await http().get(`${base}/teses`).set(bearer(leitor)).expect(200)).body as { status: string }[])[0]?.status).toBe('rascunho'); // editar derruba a aprovação
    await http().post(`${base}/teses/${tese}/arquivar`).set(bearer(redator)).expect(404);
    await http().post(`${base}/teses/${tese}/arquivar`).set(bearer(a)).expect(204);
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

      const dados = { tipo: 'impugnacao', titulo: 'Tese privada ' + sentido, texto: 'Argumento fictício com mais de vinte caracteres.' };
      const id = ((await http().post(`${raiz}/teses`).set(bearer(dono)).send(dados).expect(201)).body as { id: string }).id;
      await admin.query(`update priv.teses set validada_em = now(), bloqueada = false where id = $1`, [id]);
      await http().post(`${raiz}/teses/${id}/aprovar`).set(bearer(dono)).expect(204);
      const pecaId = (await admin.query<{ id: string }>(`insert into priv.pecas (empresa_id, acompanhamento_id, tipo, titulo) values ($1, $2, 'impugnacao', 'Peça privada') returning id`, [empresa, acompanhamento] )).rows[0]?.id ?? '';
      await http().post(`${raiz}/pecas/${pecaId}/teses/${id}`).set(bearer(dono)).expect(204);
      const snapshot = async () => (await admin.query<Record<string, unknown>>(`select
        (select jsonb_agg(t order by id) from priv.teses t where empresa_id in ($1,$2)) teses,
        (select jsonb_agg(t order by id) from priv.peca_teses t where empresa_id in ($1,$2)) usos,
        (select jsonb_agg(p order by id) from priv.pecas p where empresa_id in ($1,$2)) pecas,
        (select jsonb_agg(j order by id) from ops.jobs j where empresa_id in ($1,$2) and tipo = 'validar_tese') jobs`, [empresa, outra])).rows;
      const antes = await snapshot();
      for (const e of [empresa, outra]) {
        const base = `/empresas/${e}/juridico`;
        for (const path of ['/teses', `/pecas/${pecaId}/teses`, '/indicadores']) {
          const r = await http().get(base + path).set(bearer(invasor)).expect(e === empresa ? 404 : 200);
          if (e === outra) {
            if (path === '/indicadores') {
              expect(r.body).toEqual({ ano: null, sugeridas: 0, elaboradas: 0, protocoladas: 0, respondidas: 0, deferidas: 0, indeferidas: 0, revertidasPorRecurso: 0, prazosCumpridos: 0, prazosPerdidos: 0, porTipo: [], porTese: [] });
            } else expect(r.body).toEqual([]);
          }
          expect(await snapshot()).toEqual(antes);
        }
        const xl = await http().get(`${base}/indicadores.xlsx`).set(bearer(invasor)).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => { cb(null, Buffer.concat(c)); }); }).expect(e === empresa ? 404 : 200);
        if (e === outra) {
          // Abre as planilhas do ZIP e confere as células, não apenas a assinatura.
          const buf = xl.body as Buffer;
          let pos = 0; let xml = '';
          while (buf.readUInt32LE(pos) === 0x04034b50) {
            const tamanho = buf.readUInt32LE(pos + 18);
            const nomeFim = pos + 30 + buf.readUInt16LE(pos + 26);
            const nome = buf.subarray(pos + 30, nomeFim).toString();
            const inicio = nomeFim + buf.readUInt16LE(pos + 28);
            if (nome.startsWith('xl/worksheets/')) xml += inflateRawSync(buf.subarray(inicio, inicio + tamanho)).toString();
            pos = inicio + tamanho;
          }
          expect(xml).not.toContain(dados.titulo);
          expect(xml).not.toContain('<v>1</v>');
          expect(xml).toContain('<v>0</v>');
        }
        expect(await snapshot()).toEqual(antes);
        if (e === empresa) {
          await http().post(`${base}/teses`).set(bearer(invasor)).send(dados).expect(404);
          expect(await snapshot()).toEqual(antes);
        }
        const ausente = crypto.randomUUID();
        const casos = [
          { metodo: 'put', path: `/teses/${id}`, vazio: `/teses/${ausente}`, corpo: { titulo: dados.titulo, texto: dados.texto } },
          { metodo: 'post', path: `/teses/${id}/aprovar`, vazio: `/teses/${ausente}/aprovar`, corpo: {} },
          { metodo: 'post', path: `/teses/${id}/arquivar`, vazio: `/teses/${ausente}/arquivar`, corpo: {} },
          { metodo: 'post', path: `/pecas/${pecaId}/teses/${id}`, vazio: `/pecas/${ausente}/teses/${ausente}`, corpo: {} },
        ] as const;
        for (const caso of casos) {
          const r = await http()[caso.metodo](base + caso.path).set(bearer(invasor)).send(caso.corpo).expect(404);
          if (e === outra) {
            // Q-34: tese/peça alheia e inexistente são o mesmo 404 (P0002), nunca o 400 de estado.
            const vazio = await http()[caso.metodo](base + caso.vazio).set(bearer(invasor)).send(caso.corpo).expect(404);
            expect(r.body).toEqual(vazio.body);
          }
          expect(await snapshot(), caso.path).toEqual(antes);
        }
      }
    });
  }
});
