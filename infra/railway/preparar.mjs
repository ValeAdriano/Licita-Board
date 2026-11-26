#!/usr/bin/env node
// Preparo do banco no Railway (ADR-022). Idempotente: pode rodar a cada deploy.
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const { VV_OWNER_PASSWORD: senha, VV_KEK: kek, VV_DB_HOST: host = 'postgres.railway.internal' } = process.env;
if (!senha || !kek) throw new Error('Defina VV_OWNER_PASSWORD e VV_KEK (infra/railway/subir.sh faz isso).');
const url = `postgres://vv_owner:${encodeURIComponent(senha)}@${host}:5432/vv?sslmode=disable`;
const env = { ...process.env, DATABASE_URL: url };

execFileSync('dbmate', ['--wait', '--wait-timeout', '120s', '--migrations-dir', 'db/migrations',
  '--migrations-table', 'dbmate.schema_migrations', '--no-dump-schema', 'up'], { env, stdio: 'inherit' });

const { Client } = createRequire(new URL('../../apps/api/package.json', import.meta.url))('pg');
const c = new Client({ connectionString: url });
await c.connect();
try {
  await c.query('select core.registrar_kek(1, $1)', [kek]);
  console.log('Verificador da KEK versão 1 registrado.');
} catch (e) {
  if (e.code !== '23505') throw new Error(`Registro da KEK falhou (${e.code}).`);
  const r = await c.query('select core.conferir_kek($1) as versao', [kek]).catch(() => null);
  if (!r?.rows[0]?.versao) throw new Error('VV_KEK diferente da registrada no banco. Restaure a chave original.');
  console.log('KEK confere com a registrada.');
} finally {
  await c.end();
}

// Só o PRIMEIRO: com um SUPERADMIN no banco, variável esquecida no painel não recria nem promove ninguém.
const { VV_SUPERADMIN_EMAIL: email, VV_NOVA_SENHA: nova } = process.env;
const c2 = new Client({ connectionString: url });
await c2.connect();
const jaTem = (await c2.query('select exists(select 1 from core.usuarios where superadmin) as s')).rows[0].s;
await c2.end();
if (jaTem) console.log('Já há SUPERADMIN: nada a criar.');
else if (email && nova) {
  const r = spawnSync('node', ['scripts/criar-usuario.mjs', '--email', email, '--superadmin', '--producao'], { env, encoding: 'utf8' });
  const saida = `${r.stdout}${r.stderr}`;
  if (r.status !== 0) throw new Error(saida.trim());
  console.log('SUPERADMIN criado. Apague VV_NOVA_SENHA do serviço.');
}
