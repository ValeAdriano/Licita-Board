import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DocumentosModule } from '../documentos/documentos.module.js';
import { JuridicoController } from './juridico.controller.js';
import { RecursosController } from './recursos.controller.js';

@Module({ imports: [AuthModule, DocumentosModule], controllers: [JuridicoController, RecursosController] })
export class JuridicoModule {}
