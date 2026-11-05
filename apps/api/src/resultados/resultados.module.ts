import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ResultadosController } from './resultados.controller.js';

@Module({ imports: [AuthModule], controllers: [ResultadosController] })
export class ResultadosModule {}
