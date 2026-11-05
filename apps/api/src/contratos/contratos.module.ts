import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ContratosController } from './contratos.controller.js';

@Module({ imports: [AuthModule], controllers: [ContratosController] })
export class ContratosModule {}
