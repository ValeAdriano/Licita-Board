import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CriptoModule } from '../cripto/cripto.module.js';
import { IaController } from './ia.controller.js';

@Module({ imports: [AuthModule, CriptoModule], controllers: [IaController] })
export class IaModule {}
