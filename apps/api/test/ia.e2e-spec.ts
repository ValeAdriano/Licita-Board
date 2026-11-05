import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Chave de IA por empresa: cifrada antes do banco, nunca devolvida, só quem configura edita, A x B.
describe('chave de IA: sigilo, permissão e A x B', () => {
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
  const CHAVE = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789wxyz';

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('IA A'); empB = await criarEmpresa('IA B');
    const [eA, eB, eL] = await Promise.all([criarUsuario('ia-a'), criarUsuario('ia-b'), criarUsuario('ia-l')]);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eL, empA, 'OPERADOR', ['configuracoes:visualizar']);
    [a, b, leitor] = await Promise.all([entrar(eA), entrar(eB), entrar(eL)]);
  });
  afterAll(async () => {
    await app.close();
  });

  it('sem chave: não configurada; formato inválido é recusado sem ecoar o valor', async () => {
    const e = (await http().get(`/empresas/${empA}/ia`).set(bearer(a)).expect(200)).body as { configurada: boolean; ultimos4: string | null; modelosDisponiveis: string[] };
    expect([e.configurada, e.ultimos4, e.modelosDisponiveis.length]).toEqual([false, null, 3]);
    const r = await http().put(`/empresas/${empA}/ia/chave`).set(bearer(a)).send({ chave: 'minha-chave-secreta-invalida-123' }).expect(400);
    expect(JSON.stringify(r.body)).not.toContain('minha-chave-secreta');
    await http().put(`/empresas/${empA}/ia/chave`).set(bearer(a)).send({ chave: CHAVE, modelo: 'gpt-9' }).expect(400);
    await http().post(`/empresas/${empA}/ia/testar`).set(bearer(a)).expect(404); // sem chave cadastrada
  });

  it('cadastra a chave: o banco guarda só o envelope cifrado e a API nunca a devolve', async () => {
    await http().put(`/empresas/${empA}/ia/chave`).set(bearer(leitor)).send({ chave: CHAVE }).expect(404); // só visualizar
    await http().put(`/empresas/${empA}/ia/chave`).set(bearer(a)).send({ chave: CHAVE, modelo: 'claude-haiku-5-5' }).expect(204);
    const linha = (await admin.query<{ chave_cifrada: Record<string, unknown>; ultimos4: string }>(`select chave_cifrada, ultimos4 from priv.empresa_ia where empresa_id = $1`, [empA])).rows[0];
    expect(linha?.ultimos4).toBe('wxyz');
    expect(Object.keys(linha?.chave_cifrada ?? {}).sort()).toEqual(['ct', 'dek', 'iv', 'v']);
    expect(JSON.stringify(linha?.chave_cifrada)).not.toContain('ABCDEFGHIJKLMNOP'); // nada do texto aberto
    const corpo = JSON.stringify((await http().get(`/empresas/${empA}/ia`).set(bearer(leitor)).expect(200)).body);
    expect(corpo).not.toContain('ABCDEFGHIJKLMNOP');
    expect(corpo).not.toContain('chave_cifrada');
    const e = JSON.parse(corpo) as { configurada: boolean; ultimos4: string; modelo: string };
    expect([e.configurada, e.ultimos4, e.modelo]).toEqual([true, 'wxyz', 'claude-haiku-5-5']);
  });

  it('modelo, teste (job do worker; a API não chama o provedor) e remoção exigem configuracoes/editar', async () => {
    await http().post(`/empresas/${empA}/ia/modelo`).set(bearer(a)).send({ modelo: 'claude-opus-5-5' }).expect(204);
    await http().post(`/empresas/${empA}/ia/modelo`).set(bearer(leitor)).send({ modelo: 'claude-opus-5-5' }).expect(404);
    const antes = Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'testar_chave_ia'`)).rows[0]?.count);
    await http().post(`/empresas/${empA}/ia/testar`).set(bearer(leitor)).expect(404);
    await http().post(`/empresas/${empA}/ia/testar`).set(bearer(a)).expect(202);
    expect(Number((await admin.query<{ count: string }>(`select count(*) from ops.jobs where tipo = 'testar_chave_ia'`)).rows[0]?.count)).toBe(antes + 1);
    expect(((await http().get(`/empresas/${empA}/ia`).set(bearer(a)).expect(200)).body as { testeStatus: string }).testeStatus).toBe('pendente');
  });

  it('A x B: B não vê, não troca, não testa nem remove a chave de A; a de B é independente', async () => {
    await http().get(`/empresas/${empA}/ia`).set(bearer(b)).expect(404);
    await http().put(`/empresas/${empA}/ia/chave`).set(bearer(b)).send({ chave: CHAVE }).expect(404);
    await http().delete(`/empresas/${empA}/ia/chave`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/ia/testar`).set(bearer(b)).expect(404);
    await http().post(`/empresas/${empA}/ia/modelo`).set(bearer(b)).send({ modelo: 'claude-opus-5-5' }).expect(404);
    expect(((await http().get(`/empresas/${empB}/ia`).set(bearer(b)).expect(200)).body as { configurada: boolean }).configurada).toBe(false);
    await http().delete(`/empresas/${empA}/ia/chave`).set(bearer(leitor)).expect(404);
    await http().delete(`/empresas/${empA}/ia/chave`).set(bearer(a)).expect(204);
    expect(((await http().get(`/empresas/${empA}/ia`).set(bearer(a)).expect(200)).body as { configurada: boolean }).configurada).toBe(false);
  });
});
