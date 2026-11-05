import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DocumentosModule } from '../documentos/documentos.module.js';
import { PropostasController } from './propostas.controller.js';

@Module({ imports: [AuthModule, DocumentosModule], controllers: [PropostasController] })
export class PropostasModule {}
