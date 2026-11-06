import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BuscaController } from './busca.controller.js';

@Module({ imports: [AuthModule], controllers: [BuscaController] })
export class BuscaModule {}
