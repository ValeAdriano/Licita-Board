import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, ipNovo, servidor, subirApp, urls } from './apoio.js';

// scripts/criar-usuario.mjs: único caminho para o primeiro SUPERADMIN. O script roda como dono do
// banco; aqui usa a conexão administrativa do banco de teste.
const SCRIPT = join(import.meta.dirname, '../../../scripts/criar-usuario.mjs');
const rodar = (args: string[], env: Record<string, string> = {}) => {
  const base: Record<string, string | undefined> = { ...process.env, DATABASE_URL: urls().admin };
  delete base.VV_NOVA_SENHA;
  delete base.VV_ENV;
  return spawnSync('node', [SCRIPT, ...args], { env: { ...base, ...env }, encoding: 'utf8' });
};

describe('scripts/criar-usuario.mjs', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await subirApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('cria o SUPERADMIN com senha gerada, que entra e é levado a cadastrar o MFA', async () => {
    const email = `super-${crypto.randomUUID().slice(0, 8)}@teste.local`;
    const r = rodar(['--email', email, '--nome', 'Super Teste', '--superadmin', '--senha-na-saida']);
    expect(r.status).toBe(0);
    const senha = /Senha provisória[^:]*: (\S+)/.exec(r.stdout)?.[1] ?? '';
    expect(senha.length).toBeGreaterThanOrEqual(12);
    const linha = await admin.query<{ superadmin: boolean; senha_hash: string }>(
      'select superadmin, senha_hash from core.usuarios where email = $1', [email]);
    expect(linha.rows[0]?.superadmin).toBe(true);
    expect(linha.rows[0]?.senha_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

    const login = await request(servidor(app)).post('/auth/login').set('X-Forwarded-For', ipNovo())
      .send({ email, senha, plataforma: 'ios' }).expect(200);
    expect(login.body).toMatchObject({ mfa: 'cadastrar' });
  });

  it('--ficticio cria empresa fictícia com todas as permissões; e-mail repetido é recusado', async () => {
    const email = `ficticio-${crypto.randomUUID().slice(0, 8)}@teste.local`;
    expect(rodar(['--email', email, '--ficticio'], { VV_NOVA_SENHA: 'uma-senha-de-teste-bem-longa' }).status).toBe(0);
    const v = await admin.query<{ papel: string; n: number }>(
      `select v.papel, count(p.*)::int as n from core.vinculos v
         join core.permissoes p on p.vinculo_id = v.id
        where v.usuario_id = (select id from core.usuarios where email = $1) group by v.papel`, [email]);
    expect(v.rows[0]?.papel).toBe('ADMIN_EMPRESA');
    expect(v.rows[0]?.n).toBeGreaterThan(12);
    const de_novo = rodar(['--email', email, '--superadmin'], { VV_NOVA_SENHA: 'uma-senha-de-teste-bem-longa' });
    expect(de_novo.status).toBe(1);
    expect(de_novo.stderr).toMatch(/Já existe/);
  });

  it('banco remoto: exige --producao e TLS; ?host= na URL não engana a conferência de host', () => {
    const remoto = rodar(['--email', 'x@teste.local', '--superadmin'], { DATABASE_URL: 'postgres://vv_owner:x@db.exemplo.com.br/vv' });
    expect(remoto.status).toBe(1);
    expect(remoto.stderr).toMatch(/--producao/);
    const semTls = rodar(['--email', 'x@teste.local', '--superadmin', '--producao'], { DATABASE_URL: 'postgres://vv_owner:x@db.exemplo.com.br/vv' });
    expect(semTls.stderr).toMatch(/TLS/);
    const disfarce = rodar(['--email', 'x@teste.local', '--superadmin'], { DATABASE_URL: 'postgres://vv_owner:x@localhost/vv?host=db.exemplo.com.br' });
    expect(disfarce.status).toBe(1);
    expect(disfarce.stderr).toMatch(/não é local/);
  });

  it('recusa senha curta ou fraca, e-mail inválido, uso sem --superadmin/--ficticio, --ficticio fora de dev e valor faltando', () => {
    expect(rodar(['--email', 'x@teste.local', '--superadmin'], { VV_NOVA_SENHA: 'curta' }).stderr).toMatch(/12 a 128/);
    expect(rodar(['--email', 'x@teste.local', '--superadmin'], { VV_NOVA_SENHA: 'aaaaaaaaaaaaaaaa' }).stderr).toMatch(/fraca/);
    expect(rodar(['--email', 'sem-arroba', '--superadmin']).stderr).toMatch(/--email válido/);
    expect(rodar(['--email', 'x@teste.local']).stderr).toMatch(/--superadmin e\/ou --ficticio/);
    expect(rodar(['--email', 'x@teste.local', '--ficticio'], { VV_ENV: 'prod' }).stderr).toMatch(/VV_ENV=dev/);
    expect(rodar(['--email', '--superadmin']).stderr).toMatch(/precisa de um valor/);
    expect(() => execFileSync('node', [SCRIPT, '--nada'], { stdio: 'pipe', env: { ...process.env, DATABASE_URL: urls().admin } })).toThrow();
  });

  it('sem terminal e sem VV_NOVA_SENHA recusa gerar senha que ninguém veria', () => {
    const r = rodar(['--email', `semtty-${crypto.randomUUID().slice(0, 8)}@teste.local`, '--superadmin']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/VV_NOVA_SENHA/);
  });
});
