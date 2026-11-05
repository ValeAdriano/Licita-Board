import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrecosController } from './precos.controller.js';

@Module({ imports: [AuthModule], controllers: [PrecosController] })
export class PrecosModule {}
