import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Ficha completa da empresa (spec fase-02 §3.1, PR 1): dados gerais, CNAEs, contatos e enquadramento,
// com isolamento A x B em toda rota nova (AGENTS.md regra 13).
describe('empresa (ficha completa)', () => {
  let app: INestApplication;
  const http = () => request.agent(servidor(app)).set('X-Forwarded-For', ipNovo());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function entrar(email: string): Promise<string> {
    const login = await http().post('/auth/login').send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
    const t0 = (login.body as { token: string }).token;
    const cad = await http().post('/auth/mfa/cadastrar').set(bearer(t0)).send({ senha: SENHA }).expect(200);
    const uri = (cad.body as { uri: string }).uri;
    const conf = await http().post('/auth/mfa/confirmar').set(bearer(t0)).send({ codigo: totpDaUri(uri) }).expect(200);
    return (conf.body as { token: string }).token;
  }

  let empA: string;
  let empB: string;
  let a: string;
  let b: string;
  let contatoB: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Empresa ficha A');
    empB = await criarEmpresa('Empresa ficha B');
    const emailA = await criarUsuario('ficha-a');
    const emailB = await criarUsuario('ficha-b');
    await vincular(emailA, empA);
    await vincular(emailB, empB);
    a = await entrar(emailA);
    b = await entrar(emailB);
    const c = await http().post(`/empresas/${empB}/contatos`).set(bearer(b)).send({ tipo: 'email', valor: 'b@empresa-b.test', principal: true }).expect(201);
    contatoB = (c.body as { id: string }).id;
    await http().put(`/empresas/${empB}/cnaes`).set(bearer(b)).send({ cnaes: ['4511101'] }).expect(204);
    await http().post(`/empresas/${empB}/enquadramentos`).set(bearer(b)).send({ porte: 'EPP', dataReferencia: '2025-01-01', fonte: 'declaracao' }).expect(201);
  });
  afterAll(async () => {
    await app.close();
  });

  it('edita e lê a ficha: endereço, inscrições, CNAE, regime; CEP e CNAE com máscara viram só dígitos', async () => {
    await http().patch(`/empresas/${empA}`).set(bearer(a)).send({
      nomeFantasia: 'Alfa', inscricaoEstadual: '123.456.789', cnaePrincipal: '4511-1/01', logradouro: 'Av. Paulista', numero: '1000',
      bairro: 'Bela Vista', municipio: 'São Paulo', municipioIbge: '3550308', uf: 'SP', cep: '01310-100',
      regimeTributario: 'SIMPLES_NACIONAL', observacoes: 'Ficha de teste',
    }).expect(200);
    const r = await http().get(`/empresas/${empA}`).set(bearer(a)).expect(200);
    expect(r.body).toMatchObject({
      nomeFantasia: 'Alfa', cnaePrincipal: '4511101', cep: '01310100', uf: 'SP', municipioIbge: '3550308', regimeTributario: 'SIMPLES_NACIONAL',
    });
    await http().patch(`/empresas/${empA}`).set(bearer(a)).send({ complemento: null, observacoes: null }).expect(200);
    expect((await http().get(`/empresas/${empA}`).set(bearer(a))).body).toMatchObject({ complemento: null, observacoes: null, uf: 'SP' });
  });

  it('recusa UF, CEP, CNAE e regime inválidos, e campo que não é editável (CNPJ, ativo)', async () => {
    const t = bearer(a);
    await http().patch(`/empresas/${empA}`).set(t).send({ uf: 'XX' }).expect(400);
    await http().patch(`/empresas/${empA}`).set(t).send({ cep: '123' }).expect(400);
    await http().patch(`/empresas/${empA}`).set(t).send({ cnaePrincipal: '123' }).expect(400);
    await http().patch(`/empresas/${empA}`).set(t).send({ regimeTributario: 'INVENTADO' }).expect(400);
    await http().patch(`/empresas/${empA}`).set(t).send({ cnpj: '11222333000181' }).expect(400);
    await http().patch(`/empresas/${empA}`).set(t).send({ ativo: false }).expect(400);
  });

  it('A x B: nenhuma rota nova da empresa B responde para A (404, sem revelar que existe)', async () => {
    const t = bearer(a);
    await http().get(`/empresas/${empB}/cnaes`).set(t).expect(404);
    await http().put(`/empresas/${empB}/cnaes`).set(t).send({ cnaes: ['4511109'] }).expect(404);
    await http().get(`/empresas/${empB}/contatos`).set(t).expect(404);
    await http().post(`/empresas/${empB}/contatos`).set(t).send({ tipo: 'email', valor: 'x@y.test' }).expect(404);
    await http().patch(`/empresas/${empB}/contatos/${contatoB}`).set(t).send({ valor: 'hack@a.test' }).expect(404);
    await http().delete(`/empresas/${empB}/contatos/${contatoB}`).set(t).expect(404);
    await http().get(`/empresas/${empB}/enquadramentos`).set(t).expect(404);
    await http().post(`/empresas/${empB}/enquadramentos`).set(t).send({ porte: 'ME', dataReferencia: '2026-01-01', fonte: 'outra' }).expect(404);
    await http().get(`/empresas/${empB}/enquadramento?data=2026-01-01`).set(t).expect(404);
    await http().patch(`/empresas/${empB}`).set(t).send({ uf: 'RJ' }).expect(404);
  });

  it('A x B: o id de um contato de B não funciona pela rota de A', async () => {
    const t = bearer(a);
    await http().patch(`/empresas/${empA}/contatos/${contatoB}`).set(t).send({ valor: 'hack@a.test' }).expect(404);
    await http().delete(`/empresas/${empA}/contatos/${contatoB}`).set(t).expect(404);
    await http().patch(`/empresas/${empA}/contatos/${crypto.randomUUID()}`).set(t).send({ valor: 'x@y.test' }).expect(404);
    const naB = await admin.query<{ valor: string; deleted_at: Date | null }>('select valor, deleted_at from core.empresa_contatos where id = $1', [contatoB]);
    expect(naB.rows[0]).toMatchObject({ valor: 'b@empresa-b.test', deleted_at: null });
  });

  it('contatos: inclui, valida o formato, troca o principal, edita e remove', async () => {
    const t = bearer(a);
    const e1 = await http().post(`/empresas/${empA}/contatos`).set(t).send({ tipo: 'email', valor: 'licita@empresa-a.test', rotulo: 'Licitações', principal: true }).expect(201);
    const e2 = await http().post(`/empresas/${empA}/contatos`).set(t).send({ tipo: 'email', valor: 'outro@empresa-a.test', principal: true }).expect(201);
    await http().post(`/empresas/${empA}/contatos`).set(t).send({ tipo: 'whatsapp', valor: '+55 (11) 99999-0000' }).expect(201);
    await http().post(`/empresas/${empA}/contatos`).set(t).send({ tipo: 'email', valor: 'sem-arroba' }).expect(400);
    await http().post(`/empresas/${empA}/contatos`).set(t).send({ tipo: 'telefone', valor: '123' }).expect(400);
    await http().post(`/empresas/${empA}/contatos`).set(t).send({ tipo: 'fax', valor: '1133334444' }).expect(400);
    const lista = (await http().get(`/empresas/${empA}/contatos`).set(t).expect(200)).body as { id: string; tipo: string; valor: string; principal: boolean }[];
    expect(lista.find((c) => c.tipo === 'whatsapp')?.valor).toBe('5511999990000');
    expect(lista.filter((c) => c.tipo === 'email' && c.principal).map((c) => c.valor)).toEqual(['outro@empresa-a.test']);
    const id1 = (e1.body as { id: string }).id;
    await http().patch(`/empresas/${empA}/contatos/${id1}`).set(t).send({ principal: true, rotulo: 'Principal' }).expect(200);
    const depois = (await http().get(`/empresas/${empA}/contatos`).set(t)).body as { id: string; principal: boolean; tipo: string }[];
    expect(depois.filter((c) => c.tipo === 'email' && c.principal).map((c) => c.id)).toEqual([id1]);
    await http().patch(`/empresas/${empA}/contatos/${(e2.body as { id: string }).id}`).set(t).send({ valor: 'formato-ruim' }).expect(400);
    await http().delete(`/empresas/${empA}/contatos/${id1}`).set(t).expect(204);
    await http().delete(`/empresas/${empA}/contatos/${id1}`).set(t).expect(404);
  });

  it('CNAEs: o conjunto enviado substitui o atual', async () => {
    const t = bearer(a);
    await http().put(`/empresas/${empA}/cnaes`).set(t).send({ cnaes: ['4511-1/02', '4511103', '4511102'] }).expect(204);
    expect((await http().get(`/empresas/${empA}/cnaes`).set(t)).body).toEqual(['4511102', '4511103']);
    await http().put(`/empresas/${empA}/cnaes`).set(t).send({ cnaes: ['4511103', '4512901'] }).expect(204);
    expect((await http().get(`/empresas/${empA}/cnaes`).set(t)).body).toEqual(['4511103', '4512901']);
    await http().put(`/empresas/${empA}/cnaes`).set(t).send({ cnaes: ['123'] }).expect(400);
    expect((await http().get(`/empresas/${empB}/cnaes`).set(bearer(b))).body).toEqual(['4511101']);
  });

  it('enquadramento por data de referência: histórico, vigente por data, data inexistente e repetida', async () => {
    const t = bearer(a);
    await http().post(`/empresas/${empA}/enquadramentos`).set(t).send({ porte: 'EPP', dataReferencia: '2024-01-01', fonte: 'declaracao' }).expect(201);
    await http().post(`/empresas/${empA}/enquadramentos`).set(t).send({ porte: 'ME', dataReferencia: '2025-06-01', fonte: 'certidao_junta', observacao: 'Certidão simplificada' }).expect(201);
    await http().post(`/empresas/${empA}/enquadramentos`).set(t).send({ porte: 'ME', dataReferencia: '2025-06-01', fonte: 'outra' }).expect(409);
    await http().post(`/empresas/${empA}/enquadramentos`).set(t).send({ porte: 'ME', dataReferencia: '2026-02-30', fonte: 'outra' }).expect(400);
    await http().post(`/empresas/${empA}/enquadramentos`).set(t).send({ porte: 'GIGANTE', dataReferencia: '2026-01-01', fonte: 'outra' }).expect(400);
    const lista = (await http().get(`/empresas/${empA}/enquadramentos`).set(t)).body as { porte: string; dataReferencia: string }[];
    expect(lista.map((e) => `${e.dataReferencia}:${e.porte}`)).toEqual(['2025-06-01:ME', '2024-01-01:EPP']);
    expect((await http().get(`/empresas/${empA}/enquadramento?data=2025-05-31`).set(t).expect(200)).body).toMatchObject({ porte: 'EPP', dataReferencia: '2024-01-01' });
    expect((await http().get(`/empresas/${empA}/enquadramento?data=2025-06-01`).set(t).expect(200)).body).toMatchObject({ porte: 'ME' });
    await http().get(`/empresas/${empA}/enquadramento?data=2023-12-31`).set(t).expect(404);
    await http().get(`/empresas/${empA}/enquadramento`).set(t).expect(400);
  });

  it('OPERADOR só com empresas:visualizar lê a ficha e não escreve', async () => {
    const emailOp = await criarUsuario('ficha-op');
    await vincular(emailOp, empA, 'OPERADOR', ['empresas:visualizar']);
    const op = await entrar(emailOp);
    const t = bearer(op);
    await http().get(`/empresas/${empA}/contatos`).set(t).expect(200);
    await http().get(`/empresas/${empA}/enquadramentos`).set(t).expect(200);
    const tentativas = [
      () => http().patch(`/empresas/${empA}`).set(t).send({ uf: 'MG' }),
      () => http().put(`/empresas/${empA}/cnaes`).set(t).send({ cnaes: [] }),
      () => http().post(`/empresas/${empA}/contatos`).set(t).send({ tipo: 'email', valor: 'op@a.test' }),
      () => http().post(`/empresas/${empA}/enquadramentos`).set(t).send({ porte: 'ME', dataReferencia: '2027-01-01', fonte: 'outra' }),
    ];
    for (const tentar of tentativas) {
      expect([403, 404]).toContain((await tentar()).status);
    }
    const r = await http().get(`/empresas/${empA}`).set(bearer(a));
    expect((r.body as { uf: string }).uf).toBe('SP');
  });

  it('o valor do contato sai redigido da auditoria (dado pessoal)', async () => {
    const aud = await admin.query<{ valor: string | null }>(
      `select new_data ->> 'valor' as valor from audit.audit_log
        where table_name = 'empresa_contatos' and empresa_id = $1 and operation = 'INSERT'`, [empA]);
    expect(aud.rows.length).toBeGreaterThan(0);
    expect(aud.rows.every((r) => r.valor === '[redigido]')).toBe(true);
  });

  // Q-23: uma fixture independente por endpoint e sentido; nenhum dado sensível em asserções.
  for (const sentido of ['A → B', 'B → A']) {
    for (const caso of [
      { metodo: 'get', path: '', corpo: {} },
      { metodo: 'patch', path: '', corpo: {nomeFantasia: "Tentativa fictícia"} },
      { metodo: 'get', path: '/cnaes', corpo: {} },
      { metodo: 'put', path: '/cnaes', corpo: {cnaes: ["4511102"]} },
      { metodo: 'get', path: '/contatos', corpo: {} },
      { metodo: 'post', path: '/contatos', corpo: {tipo: "email", valor: "novo@matriz.test"} },
      { metodo: 'patch', path: '/contatos/ID', corpo: {valor: "alterado@matriz.test"} },
      { metodo: 'delete', path: '/contatos/ID', corpo: {} },
      { metodo: 'get', path: '/enquadramentos', corpo: {} },
      { metodo: 'post', path: '/enquadramentos', corpo: {porte: "ME", dataReferencia: "2027-01-01", fonte: "outra"} },
      { metodo: 'get', path: '/enquadramento?data=2026-01-01', corpo: {} }
    ] as const) {
      it(`matriz A x B empresa ${sentido}: ${caso.metodo.toUpperCase()} :empresa${caso.path}`, async () => {
        const empresas = [await criarEmpresa('Matriz fictícia A'), await criarEmpresa('Matriz fictícia B')];
        const emails = [await criarUsuario('matriz-a'), await criarUsuario('matriz-b')];
        await vincular(emails[0] ?? '', empresas[0] ?? '');
        await vincular(emails[1] ?? '', empresas[1] ?? '');
        const usuarios = [await entrar(emails[0] ?? ''), await entrar(emails[1] ?? '')] as const;
        const indice = sentido === 'A → B' ? 1 : 0;
        const empresa = empresas[indice] ?? '';
        const outra = empresas[1 - indice] ?? '';
        const dona = usuarios[indice === 1 ? 1 : 0];
        const invasora = usuarios[indice === 1 ? 0 : 1];
        const auth = (c: string) => bearer(c);
        const raiz = `/empresas/${empresa}`;
        const id = ((await http().post(`${raiz}/contatos`).set(auth(dona)).send({ tipo: 'email', valor: 'privado@matriz.test', principal: true }).expect(201)).body as { id: string }).id;
        await http().put(`${raiz}/cnaes`).set(auth(dona)).send({ cnaes: ['4511101'] }).expect(204);
        await http().post(`${raiz}/enquadramentos`).set(auth(dona)).send({ porte: 'EPP', dataReferencia: '2025-01-01', fonte: 'declaracao' }).expect(201);
        const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
        const snapshot = async () => hash((await admin.query(`select (select jsonb_agg(t order by to_jsonb(t)::text) from core.empresas t where id in ($1, $2)) as t0,
(select jsonb_agg(t order by to_jsonb(t)::text) from core.empresa_contatos t where empresa_id in ($1, $2)) as t1,
(select jsonb_agg(t order by to_jsonb(t)::text) from core.empresa_cnaes t where empresa_id in ($1, $2)) as t2,
(select jsonb_agg(t order by to_jsonb(t)::text) from core.empresa_enquadramentos t where empresa_id in ($1, $2)) as t3`, [empresa, outra])).rows);
        const antes = await snapshot();
        for (const e of (caso.path.includes('ID') ? [empresa, outra] : [empresa])) {
          if (e === outra && !caso.path.includes('ID') && caso.metodo !== 'get') continue;
          const caminho = caso.path.replace('ID', id);
          const corpo = { ...caso.corpo };
          const resposta = await http()[caso.metodo](`/empresas/${e}${caminho}`).set(auth(invasora)).send(corpo);
          if (e === outra && !caso.path.includes('ID')) {
            expect(resposta.status).toBe(200);
            expect(resposta.body).toEqual([]);
          } else {
            expect(resposta.status).toBe(404);
            const ausente = await http()[caso.metodo](`/empresas/${e === empresa ? crypto.randomUUID() : outra}${caso.path.replace('ID', crypto.randomUUID())}`).set(auth(invasora)).send(corpo);
            expect(resposta.status).toBe(ausente.status);
            expect(hash(resposta.body)).toBe(hash(ausente.body));
          }
          expect(await snapshot()).toBe(antes);
        }
      });
    }
  }

});
