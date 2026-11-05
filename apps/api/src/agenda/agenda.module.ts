import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AgendaController } from './agenda.controller.js';

@Module({ imports: [AuthModule], controllers: [AgendaController] })
export class AgendaModule {}
