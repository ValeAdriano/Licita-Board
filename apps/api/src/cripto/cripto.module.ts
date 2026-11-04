import { Module } from '@nestjs/common';
import type { Config } from '../config.js';
import { CONFIG } from '../tokens.js';
import { CifraCampo } from './cifra-campo.js';

// Cifra de campo (ADR-017): uma instância por processo, com a KEK derivada de VV_KEK.
@Module({
  providers: [{ provide: CifraCampo, useFactory: (c: Config) => new CifraCampo(c.VV_KEK), inject: [CONFIG] }],
  exports: [CifraCampo],
})
export class CriptoModule {}
