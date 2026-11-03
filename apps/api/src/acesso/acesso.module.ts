import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AcessoController } from './acesso.controller.js';
import { OperacoesController } from './operacoes.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [AcessoController, OperacoesController],
})
export class AcessoModule {}
