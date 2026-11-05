import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AnalisesController } from './analises.controller.js';

@Module({ imports: [AuthModule], controllers: [AnalisesController] })
export class AnalisesModule {}
