import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TarefasController } from './tarefas.controller.js';

@Module({ imports: [AuthModule], controllers: [TarefasController] })
export class TarefasModule {}
