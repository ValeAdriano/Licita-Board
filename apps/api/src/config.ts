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
    .default('http://localhost:8081')
    .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean))
    .pipe(z.array(z.url({ protocol: /^https?$/ }))),
  DATABASE_URL: z
    .url({ protocol: /^postgres(ql)?$/ })
    .refine((u) => new URL(u).username === 'vv_api', 'DATABASE_URL precisa usar o papel vv_api'),
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
