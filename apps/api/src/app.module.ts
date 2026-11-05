import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AcessoModule } from './acesso/acesso.module.js';
import { AgendaModule } from './agenda/agenda.module.js';
import { AnalisesModule } from './analises/analises.module.js';
import { PrecosModule } from './precos/precos.module.js';
import { PropostasModule } from './propostas/propostas.module.js';
import { ResultadosModule } from './resultados/resultados.module.js';
import { DocumentosModule } from './documentos/documentos.module.js';
import { PesquisaModule } from './pesquisa/pesquisa.module.js';
import { PushModule } from './push/push.module.js';
import { AuthModule } from './auth/auth.module.js';
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
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-csrf-token"]',
              'res.headers["set-cookie"]',
            ],
          },
        }),
        DbModule,
        AuthModule,
        AcessoModule,
        PushModule,
        DocumentosModule,
        PesquisaModule,
        AgendaModule,
        AnalisesModule,
        PrecosModule,
        PropostasModule,
        ResultadosModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}
