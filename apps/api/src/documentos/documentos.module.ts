import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DocumentosController } from './documentos.controller.js';
import { S3Servico } from './s3.service.js';

@Module({ imports: [AuthModule], controllers: [DocumentosController], providers: [S3Servico] })
export class DocumentosModule {}
