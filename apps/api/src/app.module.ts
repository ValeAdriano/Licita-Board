import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { Config } from './config.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';
import { CONFIG } from './tokens.js';

@Module({})
export class AppModule {
  static com(config: Config): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.LOG_LEVEL,
            // Logs JSON sem PII nem segredo (AGENTS.md §7): cabeçalhos de sessão nunca saem.
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          },
        }),
        DbModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}
