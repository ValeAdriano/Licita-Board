import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Publico } from '../auth/sessao.guard.js';
import { DB, type Database } from '../db/db.module.js';
import { CONFIG } from '../tokens.js';
import type { Config } from '../config.js';

// Público por definição (sem sessão): só diz se a API alcança o banco, sem detalhe de erro.
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Publico()
  @Get()
  async health(): Promise<{ status: 'ok'; banco: 'ok'; ambiente: Config['VV_ENV'] }> {
    try {
      await sql`select 1`.execute(this.db);
    } catch {
      throw new ServiceUnavailableException({ status: 'erro', banco: 'indisponivel' });
    }
    return { status: 'ok', banco: 'ok', ambiente: this.config.VV_ENV };
  }
}
