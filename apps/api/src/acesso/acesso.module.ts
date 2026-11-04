import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CriptoModule } from '../cripto/cripto.module.js';
import { AcessoController } from './acesso.controller.js';
import { EmpresaContasController } from './empresa-contas.controller.js';
import { EmpresaFichaController } from './empresa-ficha.controller.js';
import { CatalogoController } from './catalogo.controller.js';
import { PalavrasChaveController } from './palavras-chave.controller.js';
import { ProdutosController } from './produtos.controller.js';
import { ProcuracoesController } from './procuracoes.controller.js';
import { RepresentantesController } from './representantes.controller.js';
import { OperacoesController } from './operacoes.controller.js';

@Module({
  imports: [AuthModule, CriptoModule],
  controllers: [AcessoController, EmpresaFichaController, EmpresaContasController, RepresentantesController, ProcuracoesController, CatalogoController, ProdutosController, PalavrasChaveController, OperacoesController],
})
export class AcessoModule {}
