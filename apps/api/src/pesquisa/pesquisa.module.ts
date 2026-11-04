import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DocumentosModule } from '../documentos/documentos.module.js';
import { PesquisaController } from './pesquisa.controller.js';

@Module({ imports: [AuthModule, DocumentosModule], controllers: [PesquisaController] })
export class PesquisaModule {}
