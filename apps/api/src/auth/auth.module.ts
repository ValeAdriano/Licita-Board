import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ContextoService } from '../db/contexto.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { MfaController } from './mfa.controller.js';
import { SessaoGuard } from './sessao.guard.js';

@Module({
  controllers: [AuthController, MfaController],
  providers: [ContextoService, AuthService, { provide: APP_GUARD, useClass: SessaoGuard }],
  exports: [ContextoService],
})
export class AuthModule {}
