import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AcessoController } from './acesso.controller.js';
import { EmpresaFichaController } from './empresa-ficha.controller.js';
import { OperacoesController } from './operacoes.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [AcessoController, EmpresaFichaController, OperacoesController],
})
export class AcessoModule {}
