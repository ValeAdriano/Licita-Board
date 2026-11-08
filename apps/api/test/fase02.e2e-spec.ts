import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Fumaça da Fase 02 (representantes, procurações, catálogo, produtos, fichas, palavras-chave) e os
// critérios de aceite principais: atributo novo sem migration e produto em duas empresas sem vazar custo.
describe('fase 02', () => {
  let app: INestApplication;
  const http = () => request.agent(servidor(app)).set('X-Forwarded-For', ipNovo());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  interface Conta { email: string; token: string; uri: string }
  async function entrar(email: string): Promise<Conta> {
    const login = await http().post('/auth/login').send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
    const t0 = (login.body as { token: string }).token;
    const cad = await http().post('/auth/mfa/cadastrar').set(bearer(t0)).send({ senha: SENHA }).expect(200);
    const uri = (cad.body as { uri: string }).uri;
    const conf = await http().post('/auth/mfa/confirmar').set(bearer(t0)).send({ codigo: totpDaUri(uri) }).expect(200);
    await admin.query(`update core.fatores_mfa set verificado_em = now() - interval '2 days' where usuario_id = (select id from core.usuarios where email = $1)`, [email]);
    return { email, uri, token: (conf.body as { token: string }).token };
  }
  async function stepUp(c: Conta, escopo: string): Promise<string> {
    await admin.query(`update core.fatores_mfa set ultimo_passo = 0 where usuario_id = (select id from core.usuarios where email = $1)`, [c.email]);
    const r = await http().post('/auth/mfa/step-up').set(bearer(c.token)).send({ codigo: totpDaUri(c.uri), escopo }).expect(200);
    const b = r.body as { stepUp: string; token: string };
    c.token = b.token;
    return b.stepUp;
  }

  let empA: string; let empB: string; let a: Conta; let b: Conta; let sup: Conta;
  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Empresa fase2 A');
    empB = await criarEmpresa('Empresa fase2 B');
    const emailA = await criarUsuario('f2-a'); const emailB = await criarUsuario('f2-b'); const emailS = await criarUsuario('f2-s');
    await vincular(emailA, empA); await vincular(emailB, empB);
    await admin.query('update core.usuarios set superadmin = true where email = $1', [emailS]);
    a = await entrar(emailA); b = await entrar(emailB); sup = await entrar(emailS);
  });
  afterAll(async () => {
    await app.close();
  });

  it('representante: CPF validado e cifrado, só máscara na lista, revelar com step-up; poderes, procuração e signatário', async () => {
    const t = () => bearer(a.token);
    await http().post(`/empresas/${empA}/representantes`).set(t()).send({ tipo: 'PROCURADOR', nome: 'Caio', cpf: '529.982.247-26' }).expect(400);
    const r = await http().post(`/empresas/${empA}/representantes`).set(t()).send({ tipo: 'PROCURADOR', nome: 'Caio Procurador', cpf: '529.982.247-25', email: 'caio@a.test' }).expect(201);
    const id = (r.body as { id: string }).id;
    await http().post(`/empresas/${empA}/representantes`).set(t()).send({ tipo: 'ADVOGADO', nome: 'Sem OAB', cpf: '111.444.777-35' }).expect(400);
    await http().post(`/empresas/${empA}/representantes`).set(t()).send({ tipo: 'PROCURADOR', nome: 'CPF repetido', cpf: '52998224725' }).expect(409);
    const lista = (await http().get(`/empresas/${empA}/representantes`).set(t()).expect(200)).body as { cpfMascara: string }[];
    expect(JSON.stringify(lista)).not.toContain('52998224725');
    expect(lista[0]?.cpfMascara).toContain('•');
    const su = await stepUp(a, 'dados_pessoais');
    const rev = await http().post(`/empresas/${empA}/representantes/${id}/revelar-cpf`).set(t()).send({ stepUp: su }).expect(200);
    expect(rev.body).toEqual({ valor: '52998224725' });

    await http().put(`/empresas/${empA}/representantes/${id}/poderes`).set(t()).send({ poderes: ['assinar_proposta'] }).expect(204);
    const proc = await http().post(`/empresas/${empA}/representantes/${id}/procuracoes`).set(t())
      .send({ numero: '123', dataEmissao: '2026-01-10', dataValidade: '2026-06-30', poderes: ['assinar_proposta'] }).expect(201);
    const consulta = (data: string, poder: string) => http().get(`/empresas/${empA}/representantes/${id}/signatario-valido?data=${data}&poder=${poder}`).set(t()).expect(200);
    expect((await consulta('2026-06-30', 'assinar_proposta')).body).toEqual({ valido: true });
    expect((await consulta('2026-07-01', 'assinar_proposta')).body).toEqual({ valido: false });
    expect((await consulta('2026-03-01', 'firmar_contrato')).body).toEqual({ valido: false });
    await http().post(`/empresas/${empA}/procuracoes/${(proc.body as { id: string }).id}/revogar`).set(t()).send({ data: '2026-04-01' }).expect(204);
    expect((await consulta('2026-04-01', 'assinar_proposta')).body).toEqual({ valido: false });
    await http().get(`/empresas/${empB}/representantes`).set(bearer(a.token)).expect(404);
  });

  it('catálogo: SUPERADMIN cria atributo e modelo sem migration; os demais só leem; conversão exata', async () => {
    const cats = (await http().get('/catalogo/categorias').set(bearer(a.token)).expect(200)).body as { id: string; slug: string }[];
    const veiculos = cats.find((c) => c.slug === 'veiculos')?.id ?? '';
    await http().post('/catalogo/atributos').set(bearer(a.token)).send({ categoriaId: veiculos, slug: 'cor_invasora', nome: 'Cor', tipo: 'texto' }).expect(403);
    const novo = await http().post('/catalogo/atributos').set(bearer(sup.token)).send({ categoriaId: veiculos, slug: 'cor_e2e', nome: 'Cor', tipo: 'texto' }).expect(201);
    expect((novo.body as { id: string }).id).toBeTruthy();
    const conv = await http().get('/catalogo/converter?valor=100&de=cv&para=kW').set(bearer(a.token)).expect(200);
    expect(Number((conv.body as { valor: string }).valor)).toBeCloseTo(73.549875, 6);
    await http().get('/catalogo/converter?valor=1&de=kW&para=kg').set(bearer(a.token)).expect(400);
  });

  it('produto em duas empresas: modelo compartilhado, custo e produto de A invisíveis para B; atributo novo gravado', async () => {
    const cats = (await http().get('/catalogo/categorias').set(bearer(sup.token))).body as { id: string; slug: string }[];
    const veiculos = cats.find((c) => c.slug === 'veiculos')?.id ?? '';
    const modelo = await http().post('/catalogo/modelos').set(bearer(sup.token)).send({ categoriaId: veiculos, fabricante: 'Fab E2E', modelo: 'Modelo X', anoModelo: 2026 }).expect(201);
    const modeloId = (modelo.body as { id: string }).id;
    const atrs = (await http().get(`/catalogo/atributos?categoria=${veiculos}`).set(bearer(a.token)).expect(200)).body as { id: string; slug: string; unidadePadraoId: string | null }[];
    const pot = atrs.find((x) => x.slug === 'potencia');
    const cor = atrs.find((x) => x.slug === 'cor_e2e');
    expect(cor).toBeTruthy();
    await http().put(`/catalogo/modelos/${modeloId}/atributos`).set(bearer(sup.token)).send({ atributos: [{ atributoId: pot?.id, valorNumero: '110', unidadeId: pot?.unidadePadraoId }] }).expect(204);

    const mk = async (c: Conta, emp: string, codigo: string) => (await http().post(`/empresas/${emp}/produtos`).set(bearer(c.token))
      .send({ modeloId, categoriaId: veiculos, codigoInterno: codigo, descricao: 'Veículo do catálogo', fornecedor: 'Forn' }).expect(201)).body as { id: string };
    const pa = await mk(a, empA, 'VEI-1');
    const pb = await mk(b, empB, 'VEI-1');
    await http().post(`/empresas/${empA}/produtos`).set(bearer(a.token)).send({ modeloId, categoriaId: veiculos, codigoInterno: 'VEI-1', descricao: 'dup' }).expect(409);
    await http().put(`/empresas/${empA}/produtos/${pa.id}/atributos`).set(bearer(a.token)).send({ atributos: [{ atributoId: cor?.id, valorTexto: 'Branca' }] }).expect(204);
    await http().put(`/empresas/${empA}/produtos/${pa.id}/atributos`).set(bearer(a.token)).send({ atributos: [{ atributoId: pot?.id, valorNumero: '110', unidadeId: null }] }).expect(400);
    await http().put(`/empresas/${empA}/produtos/${pa.id}/precos`).set(bearer(a.token)).send({ precoCusto: '85000.5000', precoReferencia: '99900.0000' }).expect(204);
    await http().put(`/empresas/${empB}/produtos/${pb.id}/precos`).set(bearer(b.token)).send({ precoCusto: '70000', precoReferencia: '80000' }).expect(204);

    expect((await http().get(`/empresas/${empA}/produtos/${pa.id}/precos`).set(bearer(a.token)).expect(200)).body).toEqual({ precoCusto: '85000.5000', precoReferencia: '99900.0000' });
    expect((await http().get(`/empresas/${empB}/produtos/${pb.id}/precos`).set(bearer(b.token)).expect(200)).body).toEqual({ precoCusto: '70000.0000', precoReferencia: '80000.0000' });
    await http().get(`/empresas/${empA}/produtos/${pb.id}`).set(bearer(a.token)).expect(404);
    const precosDeB = await http().get(`/empresas/${empA}/produtos/${pb.id}/precos`).set(bearer(a.token)).expect(200);
    expect(precosDeB.body).toEqual({ precoCusto: null, precoReferencia: null });
    await http().get(`/empresas/${empB}/produtos`).set(bearer(a.token)).expect(404);
    const listaB = (await http().get(`/empresas/${empB}/produtos`).set(bearer(b.token)).expect(200)).body as { id: string }[];
    expect(listaB.map((p) => p.id)).toEqual([pb.id]);
    const todosA = (await http().get(`/empresas/${empA}/produtos`).set(bearer(a.token))).body as { id: string }[];
    const ids = new Set(todosA.map((p) => p.id));
    expect(ids.has(pb.id)).toBe(false);

    // Fichas: nova versão preserva a anterior (histórico).
    const f1 = await http().post(`/empresas/${empA}/produtos/${pa.id}/fichas`).set(bearer(a.token)).send({ fabricante: 'Fab E2E', modelo: 'Modelo X', ano: 2026, validaAte: '2099-12-31' }).expect(201);
    await http().post(`/empresas/${empA}/produtos/${pa.id}/fichas`).set(bearer(a.token)).send({ fabricante: 'Fab E2E', modelo: 'Modelo X', ano: 2027 }).expect(201);
    const fichas = (await http().get(`/empresas/${empA}/produtos/${pa.id}/fichas`).set(bearer(a.token))).body as { versaoFicha: number; situacao: string; ano: number }[];
    expect(fichas.map((f) => `${String(f.versaoFicha)}:${f.situacao}:${String(f.ano)}`)).toEqual(['2:vigente:2027', '1:substituida:2026']);
    await http().patch(`/empresas/${empA}/fichas/${(f1.body as { id: string }).id}`).set(bearer(a.token)).send({ situacao: 'descontinuada' }).expect(404);
  });

  it('palavras-chave: normaliza o termo (sem acento, caixa), recusa repetido, filtros por UF e faixa de valor', async () => {
    const t = () => bearer(a.token);
    await http().post(`/empresas/${empA}/palavras-chave`).set(t()).send({ tipo: 'palavra', termo: 'Ambulância' }).expect(201);
    await http().post(`/empresas/${empA}/palavras-chave`).set(t()).send({ tipo: 'palavra', termo: '  ambulancia ' }).expect(409);
    await http().post(`/empresas/${empA}/palavras-chave`).set(t()).send({ tipo: 'exclusao', termo: 'usada' }).expect(201);
    await http().post(`/empresas/${empA}/palavras-chave-filtros`).set(t()).send({ tipo: 'uf', uf: 'SP' }).expect(201);
    await http().post(`/empresas/${empA}/palavras-chave-filtros`).set(t()).send({ tipo: 'faixa_valor', valorMin: '1000', valorMax: '500' }).expect(400);
    await http().post(`/empresas/${empA}/palavras-chave-filtros`).set(t()).send({ tipo: 'faixa_valor', valorMin: '1000.50', valorMax: '5000' }).expect(201);
    const r = (await http().get(`/empresas/${empA}/palavras-chave`).set(t()).expect(200)).body as { termos: { termo: string }[]; filtros: unknown[] };
    expect(r.termos.map((x) => x.termo).sort()).toEqual(['Ambulância', 'usada']);
    expect(r.filtros).toHaveLength(2);
    expect((await http().get(`/empresas/${empB}/palavras-chave`).set(bearer(b.token)).expect(200)).body).toEqual({ termos: [], filtros: [] });
    await http().get(`/empresas/${empB}/palavras-chave`).set(t()).expect(404);
  });

  // Q-23: uma fixture independente por endpoint e sentido; nenhum dado sensível em asserções.
  for (const sentido of ['A → B', 'B → A']) {
    for (const caso of [
      { metodo: 'get', path: '/representantes', corpo: {} },
      { metodo: 'post', path: '/representantes', corpo: {tipo: "PROCURADOR", nome: "Tentativa fictícia", cpf: "11144477735"} },
      { metodo: 'patch', path: '/representantes/ID', corpo: {nome: "Tentativa fictícia"} },
      { metodo: 'post', path: '/representantes/ID/arquivar', corpo: {} },
      { metodo: 'post', path: '/representantes/ID/revelar-cpf', corpo: {} }
    ] as const) {
      it(`matriz A x B fase02 ${sentido}: ${caso.metodo.toUpperCase()} :empresa${caso.path}`, async () => {
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
        const auth = (c: Conta) => bearer(c.token);
        const raiz = `/empresas/${empresa}`;
        const id = ((await http().post(`${raiz}/representantes`).set(auth(dona)).send({ tipo: 'PROCURADOR', nome: 'Representante fictício reservado', cpf: '52998224725', rg: 'RG-ficticio-reservado' }).expect(201)).body as { id: string }).id;
        const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
        const snapshot = async () => hash((await admin.query(`select (select jsonb_agg(t order by to_jsonb(t)::text) from core.representantes t where empresa_id in ($1, $2)) as t0, (select jsonb_agg(t order by to_jsonb(t)::text) from core.revelacoes_dados t where empresa_id in ($1, $2)) as revelacoes`, [empresa, outra])).rows);
        const antes = await snapshot();
        for (const e of [empresa, outra]) {
          if (e === outra && !caso.path.includes('ID') && caso.metodo !== 'get') continue;
          const caminho = caso.path.replace('ID', id);
          const corpo = { ...caso.corpo, ...(caso.path.endsWith('revelar-cpf') ? { stepUp: await stepUp(invasora, 'dados_pessoais') } : {}) };
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

  // Rodada 10: cada linha gera dois casos, com empresas/usuários/objetos exclusivos.
  for (const sentido of ['A → B', 'B → A']) {
    for (const caso of [
      ['get', '/produtos', {}],
      ['post', '/produtos', { codigoInterno: 'tentativa', descricao: 'Tentativa fictícia' }],
      ['get', '/produtos/P', {}],
      ['patch', '/produtos/P', { descricao: 'Tentativa fictícia' }],
      ['post', '/produtos/P/arquivar', {}],
      ['get', '/produtos/P/precos', {}],
      ['put', '/produtos/P/precos', { precoCusto: '1', precoReferencia: '2' }],
      ['get', '/produtos/P/atributos', {}],
      ['put', '/produtos/P/atributos', { atributos: [] }],
      ['get', '/produtos/P/fichas', {}],
      ['post', '/produtos/P/fichas', { fabricante: 'Tentativa', modelo: 'Fictício' }],
      ['patch', '/fichas/F', { situacao: 'descontinuada' }],
      ['get', '/representantes/R/poderes', {}],
      ['put', '/representantes/R/poderes', { poderes: [] }],
      ['get', '/representantes/R/procuracoes', {}],
      ['post', '/representantes/R/procuracoes', { dataEmissao: '2026-01-01', poderes: ['assinar_proposta'] }],
      ['patch', '/procuracoes/C', { numero: 'Tentativa', poderes: [] }],
      ['post', '/procuracoes/C/revogar', { data: '2026-02-01' }],
      ['post', '/procuracoes/C/arquivar', {}],
      ['get', '/representantes/R/signatario-valido?data=2026-02-01&poder=assinar_proposta', {}],
      ['get', '/palavras-chave', {}],
      ['post', '/palavras-chave', { tipo: 'palavra', termo: 'Tentativa' }],
      ['patch', '/palavras-chave/T', { termo: 'Tentativa', ativo: false }],
      ['post', '/palavras-chave/T/arquivar', {}],
      ['post', '/palavras-chave-filtros', { tipo: 'uf', uf: 'RJ' }],
      ['post', '/palavras-chave-filtros/L/arquivar', {}],
    ] as const) {
      const [metodo, path, corpo] = caso;
      it(`matriz rodada 10 ${sentido}: ${metodo.toUpperCase()} :empresa${path}`, async () => {
        const empresas = [await criarEmpresa('Rodada 10 fictícia A'), await criarEmpresa('Rodada 10 fictícia B')];
        const contas: Conta[] = [];
        for (const empresa of empresas) {
          const email = await criarUsuario('rodada10');
          await vincular(email, empresa);
          contas.push(await entrar(email));
        }
        const indice = sentido === 'A → B' ? 1 : 0;
        const empresa = empresas[indice] ?? '';
        const propria = empresas[1 - indice] ?? '';
        const dona = contas[indice];
        if (!dona) throw new Error('fixture sem dona');
        const invasora = contas[1 - indice];
        if (!invasora) throw new Error('fixture sem invasora');
        const raiz = `/empresas/${empresa}`;
        const criar = async (path: string, body: object) => ((await http().post(raiz + path).set(bearer(dona.token)).send(body).expect(201)).body as { id: string }).id;
        const categoriaId = ((await http().get('/catalogo/categorias').set(bearer(dona.token)).expect(200)).body as { id: string; slug: string }[]).find((c) => c.slug === 'veiculos')?.id ?? '';
        const P = await criar('/produtos', { categoriaId, codigoInterno: 'reservado', descricao: 'Produto fictício reservado' });
        await http().put(`${raiz}/produtos/${P}/precos`).set(bearer(dona.token)).send({ precoCusto: '98765.4321', precoReferencia: '123456.7890' }).expect(204);
        const documento = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao, sem_vencimento) select $1, id, 'Arquivo fictício reservado', true from pub.tipos_documento where slug = 'outro' returning id`, [empresa])).rows[0]?.id ?? '';
        const F = (await admin.query<{ id: string }>(`insert into priv.fichas_tecnicas (empresa_id, produto_id, versao_ficha, fabricante, modelo, documento_id, fonte_oficial) values ($1, $2, 1, 'Fabricante reservado', 'Modelo reservado', $3, 'https://arquivo.exemplo.invalid/ficha-reservada') returning id`, [empresa, P, documento])).rows[0]?.id ?? '';
        const atributos = ((await http().get(`/catalogo/atributos?categoria=${categoriaId}`).set(bearer(dona.token)).expect(200)).body as { id: string; tipo: string; unidadePadraoId: string | null }[]);
        const atributo = atributos.find((x) => x.tipo === 'numero' && x.unidadePadraoId);
        if (!atributo) throw new Error('fixture sem atributo numérico');
        {
          await http().put(`${raiz}/produtos/${P}/atributos`).set(bearer(dona.token)).send({ atributos: [{ atributoId: atributo.id, valorNumero: '110', unidadeId: atributo.unidadePadraoId }] }).expect(204);
        }
        const R = await criar('/representantes', { tipo: 'PROCURADOR', nome: 'Outorgado fictício reservado', cpf: '52998224725' });
        await http().put(`${raiz}/representantes/${R}/poderes`).set(bearer(dona.token)).send({ poderes: ['assinar_proposta'] }).expect(204);
        const C = await criar(`/representantes/${R}/procuracoes`, { numero: 'Reservado', observacao: 'Observação fictícia reservada', dataEmissao: '2026-01-01', poderes: ['assinar_proposta'] });
        await admin.query('update core.procuracoes set documento_id = $1 where id = $2', [documento, C]);
        const T = await criar('/palavras-chave', { tipo: 'palavra', termo: 'Termo reservado' });
        const L = await criar('/palavras-chave-filtros', { tipo: 'restricao', texto: 'Filtro reservado' });
        const ids: Record<string, string> = { P, F, R, C, T, L };
        const caminho = (ausente: boolean) => path.replace(/\b[PFRCTL]\b/g, (k) => ausente ? crypto.randomUUID() : (ids[k] ?? ''));
        const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
        const tabelas = ['priv.documentos', 'priv.produtos', 'priv.produto_precos', 'priv.produto_atributos', 'priv.fichas_tecnicas', 'core.representantes', 'core.representante_poderes', 'core.procuracoes', 'core.procuracao_poderes', 'priv.palavras_chave', 'priv.palavras_chave_filtros'];
        const snapshot = async () => hash(await Promise.all(tabelas.map(async (t) =>
          (await admin.query<{ dado: unknown }>(`select to_jsonb(t) as dado from ${t} t where empresa_id = any($1::uuid[]) order by to_jsonb(t)::text`, [empresas])).rows)));
        const antes = await snapshot();
        const body = path === '/produtos' && metodo === 'post' ? { ...corpo, categoriaId } : corpo;
        // Empresa alheia: guard; empresa própria + ID alheio: controller/RLS.
        for (const e of [empresa, propria]) {
          const temId = /\b[PFRCTL]\b/.test(path);
          if (e === propria && !temId && metodo !== 'get') continue;
          const r = await http()[metodo](`/empresas/${e}${caminho(false)}`).set(bearer(invasora.token)).send(body);
          const ausente = await http()[metodo](`/empresas/${e === empresa ? crypto.randomUUID() : propria}${caminho(true)}`).set(bearer(invasora.token)).send(body);
          const esperado = e === empresa ? 404 : metodo === 'get' && path !== '/produtos/P' && !path.includes('signatario') ? 200 : 404; // procuração com representante alheio: 404 (Q-34)
          expect(r.status).toBe(esperado);
          expect(r.status).toBe(ausente.status);
          expect(hash(r.body)).toBe(hash(ausente.body));
          if (esperado === 200) {
            expect(r.body).toEqual(path === '/palavras-chave' ? { termos: [], filtros: [] } : path.endsWith('/precos') ? { precoCusto: null, precoReferencia: null } : []);
          }
          expect(await snapshot()).toBe(antes);
        }
      });
    }
  }

});
