import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import type { Config } from './config.js';

// Configuração de HTTP comum ao main e aos e2e. A app precisa ser criada com { bodyParser: false }.
export function configurarApp(app: INestApplication, config: Config): void {
  const nest = app as NestExpressApplication;
  nest.set('trust proxy', config.TRUST_PROXY === 'false' ? false : config.TRUST_PROXY);
  nest.disable('x-powered-by');
  // Só JSON, e pequeno: formulário (urlencoded) de outro site não chega a /auth/login (login CSRF).
  nest.useBodyParser('json', { limit: '16kb' });
  app.use(cookieParser());
  // A API só serve dado privado ou de sessão: nada em cache, nada de sniffing de tipo.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  // credentials: o cookie HttpOnly de sessão do web (ADR-012) só viaja para origens listadas.
  app.enableCors({ origin: config.CORS_ORIGINS, credentials: true });
}
