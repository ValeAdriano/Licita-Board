import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { CONFIG } from '../tokens.js';
import type { Config } from '../config.js';

// Tipos gerados por kysely-codegen a partir das migrations (Fase 01). Vazio enquanto não há tabelas.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database {}

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [CONFIG],
      useFactory: (config: Config) =>
        new Kysely<Database>({
          dialect: new PostgresDialect({
            pool: new Pool({ connectionString: config.DATABASE_URL, max: 10 }),
          }),
        }),
    },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
