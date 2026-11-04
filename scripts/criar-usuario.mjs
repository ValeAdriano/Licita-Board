#!/usr/bin/env node
// Cria um usuário (opcionalmente SUPERADMIN) direto no banco, como dono (vv_owner). É a única forma de
// ter o primeiro SUPERADMIN: a API não cria usuário (só por convite) e `superadmin` não é gravável por
// ela. Ferramenta de operação: não faz parte da API e nunca roda dentro dela (regra 11 do AGENTS.md).
//
// Uso (a partir da raiz, depois de `npm ci --prefix apps/api`). A conexão do dono NÃO vai na linha de
// comando (fica no histórico do shell): leia do .env, como no AGENTS.md §6.
//   set -a && . ./.env && set +a
//   export DATABASE_URL="postgres://vv_owner:$VV_OWNER_PASSWORD@localhost:5433/vv"
//   read -rs VV_NOVA_SENHA && export VV_NOVA_SENHA      # opcional; 12 a 128 caracteres
//   node scripts/criar-usuario.mjs --email voce@empresa.com.br --nome "Seu Nome" --superadmin [--ficticio]
//
// Obrigatório: --superadmin e/ou --ficticio (a API cria os demais usuários, por convite; aqui o e-mail
// já nasce verificado, e isso só vale para quem você mesmo está cadastrando).
// Senha: sem VV_NOVA_SENHA, o script gera uma aleatória e a mostra uma única vez, mas só em terminal
// interativo (--senha-na-saida força, para testes). Entre e cadastre o autenticador (MFA) logo em
// seguida: até lá, quem souber a senha cadastraria o MFA dele (T5.12). O primeiro login de perfil
// interno obriga o cadastro.
// --ficticio: cria também uma empresa FICTÍCIA (CNPJ gerado) e vincula o usuário como ADMIN_EMPRESA
// com todas as permissões, para testar as telas. Só em desenvolvimento: recusado com VV_ENV diferente
// de dev e com banco remoto. Atenção: um túnel SSH para produção parece local; confira o DATABASE_URL.
// Servidor que não é local exige --producao e TLS na conexão (sslmode=require ou verify-full).
import { randomBytes, randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const requerer = createRequire(join(raiz, 'apps/api/package.json'));

// Mesmos parâmetros de apps/api/src/auth/senha.ts (ADR-012); o teste e2e confere que o login aceita.
const PARAMETROS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const ACOES = ['visualizar', 'cadastrar', 'editar', 'arquivar', 'substituir_arquivos', 'gerar_documentos',
  'ver_custos_margens', 'elaborar_peca', 'aprovar_peca', 'aprovar', 'exportar', 'administrar_permissoes'];

function ler(argv) {
  const o = { superadmin: false, ficticio: false, producao: false, senhaNaSaida: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--superadmin' || a === '--ficticio' || a === '--producao') o[a.slice(2)] = true;
    else if (a === '--senha-na-saida') o.senhaNaSaida = true;
    else if (a === '--email' || a === '--nome') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} precisa de um valor.`);
      o[a.slice(2)] = v;
    } else throw new Error(`Argumento desconhecido: ${a}`);
  }
  return o;
}

// CNPJ numérico fictício com dígitos verificadores válidos.
function cnpjFicticio() {
  const base = Array.from({ length: 12 }, () => randomInt(10));
  const dv = (pesos, n) => {
    const r = n.reduce((s, d, i) => s + d * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], base);
  const d2 = dv([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [...base, d1]);
  return [...base, d1, d2].join('');
}

async function principal() {
  const o = ler(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (conexão como vv_owner).');
  if (!o.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) throw new Error('Informe --email válido.');
  if (!o.superadmin && !o.ficticio) throw new Error('Informe --superadmin e/ou --ficticio (os demais usuários entram por convite).');
  if (o.ficticio && o.producao) throw new Error('--ficticio não combina com --producao.');
  if (o.ficticio && (process.env.VV_ENV ?? 'dev') !== 'dev') throw new Error('--ficticio só com VV_ENV=dev.');

  const argon2 = requerer('argon2');
  const { Client } = requerer('pg');
  const c = new Client({ connectionString: url });
  // O host vale o que o cliente do banco vai usar de verdade (a URL pode trazer ?host= ou ?hostaddr=).
  const local = ['localhost', '127.0.0.1', '::1', 'postgres'].includes(c.host) && !/[?&]host(addr)?=/.test(url);
  if (!local) {
    if (!o.producao) throw new Error(`O banco (${c.host}) não é local. Para produção, confirme com --producao.`);
    if (!/[?&]sslmode=(require|verify-full)\b/.test(url)) throw new Error('Banco remoto exige TLS: acrescente ?sslmode=verify-full à DATABASE_URL.');
  }

  const geradaAgora = !process.env.VV_NOVA_SENHA;
  const senha = process.env.VV_NOVA_SENHA ?? randomBytes(18).toString('base64url');
  if (senha.length < 12 || senha.length > 128) throw new Error('A senha precisa ter de 12 a 128 caracteres.');
  if (new Set(senha).size < 6) throw new Error('Senha fraca demais: use ao menos 6 caracteres diferentes.');
  if (geradaAgora && !process.stdout.isTTY && !o.senhaNaSaida) {
    throw new Error('Sem terminal para mostrar a senha gerada: defina VV_NOVA_SENHA (ou use --senha-na-saida).');
  }
  const hash = await argon2.hash(senha, { type: argon2.argon2id, ...PARAMETROS });

  await c.connect();
  try {
    await c.query('begin');
    const u = await c.query(
      `insert into core.usuarios (email, nome, senha_hash, superadmin, email_verificado_em)
       values ($1, $2, $3, $4, now()) returning id`,
      [o.email, o.nome ?? o.email.split('@')[0], hash, o.superadmin]);
    const usuario = u.rows[0].id;
    let empresa = null;
    if (o.ficticio) {
      const e = await c.query(
        'insert into core.empresas (razao_social, cnpj) values ($1, $2) returning id, cnpj',
        [`Empresa Fictícia ${randomBytes(3).toString('hex')} Ltda`, cnpjFicticio()]);
      const v = await c.query(
        `insert into core.vinculos (usuario_id, empresa_id, papel) values ($1, $2, 'ADMIN_EMPRESA') returning id`,
        [usuario, e.rows[0].id]);
      await c.query(
        `insert into core.permissoes (vinculo_id, empresa_id, modulo, acao)
         select $1, $2, m.slug, a from core.modulos m, unnest($3::text[]) a`,
        [v.rows[0].id, e.rows[0].id, ACOES]);
      empresa = e.rows[0].cnpj;
    }
    await c.query('commit');
    console.log(`Usuário criado: ${o.email}${o.superadmin ? ' (SUPERADMIN)' : ''}${empresa ? `, empresa fictícia CNPJ ${empresa}` : ''}`);
    if (geradaAgora) {
      console.log(`Senha provisória (aparece só agora; troque em Conta depois do primeiro acesso): ${senha}`);
    }
    console.log('Entre agora e cadastre o autenticador (MFA): até lá, quem souber a senha poderia cadastrar o dele.');
  } catch (e) {
    await c.query('rollback').catch(() => {});
    if (e?.code === '23505' && String(e.constraint ?? '').includes('email')) throw new Error('Já existe usuário com esse e-mail.');
    throw e;
  } finally {
    await c.end();
  }
}

principal().catch((e) => {
  console.error(`Erro: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
