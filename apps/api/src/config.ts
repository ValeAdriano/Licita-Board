import { isIP } from 'node:net';
import { z } from 'zod';

// Configuração validada na subida: variável faltando ou inválida derruba a API antes de abrir porta.
// A API só conhece a credencial de vv_api (ADR-013); credenciais de owner/worker nunca entram aqui.
const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VV_ENV: z.enum(['dev', 'homolog', 'prod']).default('dev'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Origens do app web com acesso à API (lista separada por vírgula). O app nativo não usa CORS.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean))
    .pipe(z.array(z.url({ protocol: /^https?$/ }))),
  // Proxy cujo X-Forwarded-For é confiável: "false" (ignora o cabeçalho), "loopback" ou lista de
  // IP/CIDR (em produção, o IP fixo do Caddy na rede do compose). Nada de "true" ou número de saltos.
  TRUST_PROXY: z
    .string()
    .default('loopback')
    .refine(
      (v) =>
        v === 'false' ||
        v === 'loopback' ||
        v.split(',').every((p) => {
          const [ip = '', mascara] = p.trim().split('/');
          const max = isIP(ip) === 6 ? 128 : 32;
          return isIP(ip) !== 0 && (mascara === undefined || (/^\d{1,3}$/.test(mascara) && Number(mascara) <= max));
        }),
      'TRUST_PROXY precisa ser false, loopback ou lista de IP/CIDR',
    ),
  // Atraso fixo na resposta de login recusado (ms): iguala senha errada e corrida perdida.
  LOGIN_ATRASO_MS: z.coerce.number().int().min(0).max(1000).default(250),
  // Senha vazada (HIBP, k-anonymity). Vazio = só a lista local (testes, sem rede).
  HIBP_URL: z.string().default('https://api.pwnedpasswords.com/range/'),
  // Chave pública VAPID do Web Push (a privada fica só no worker). Vazio = push desligado (404 em
  // GET /push/chave e o front não oferece a opção).
  VAPID_PUBLIC_KEY: z.string().regex(/^([A-Za-z0-9_-]{80,100})?$/, 'VAPID_PUBLIC_KEY inválida').default(''),
  // CAPTCHA Turnstile a partir da 3ª falha. Vazio = desligado (dev/teste).
  TURNSTILE_SECRET: z.string().default(''),
  // Chave-mestra (ADR-017): o banco só aceita login, recuperação e MFA com ela (confere contra o
  // verificador registrado por db/scripts/registrar-kek.sh). Nunca em log nem no app.
  VV_KEK: z.string().min(32, 'VV_KEK precisa de pelo menos 32 caracteres'),
  DATABASE_URL: z
    .url({ protocol: /^postgres(ql)?$/ })
    .refine((u) => new URL(u).username === 'vv_api', 'DATABASE_URL precisa usar o papel vv_api'),
}).superRefine((c, ctx) => {
  if (c.VV_ENV === 'dev') return;
  // Fora de dev: origem do app explícita e só https; proxy confiável explícito (IP/CIDR do Caddy na
  // rede do compose). Com "loopback", todo pedido pareceria vir do Caddy e o limite por IP valeria
  // para a plataforma inteira.
  if (c.CORS_ORIGINS.some((o) => !o.startsWith('https://') || o.includes('localhost'))) {
    ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'fora de dev, CORS_ORIGINS só com https' });
  }
  if (c.TRUST_PROXY === 'loopback' || c.TRUST_PROXY === 'false') {
    ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'fora de dev, TRUST_PROXY é o IP/CIDR do Caddy' });
  }
  // CAPTCHA e senha vazada não podem sumir por falta de configuração.
  if (!c.TURNSTILE_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['TURNSTILE_SECRET'], message: 'fora de dev, TURNSTILE_SECRET é obrigatório' });
  }
  if (!c.HIBP_URL.startsWith('https://')) {
    ctx.addIssue({ code: 'custom', path: ['HIBP_URL'], message: 'fora de dev, HIBP_URL precisa ser https' });
  }
});

export type Config = z.infer<typeof esquema>;

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = esquema.safeParse(env);
  if (!r.success) {
    // Só os caminhos e mensagens: nunca o valor, que pode conter senha.
    const erros = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida: ${erros}`);
  }
  return r.data;
}
