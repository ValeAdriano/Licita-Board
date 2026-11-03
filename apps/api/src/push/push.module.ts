import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PushController } from './push.controller.js';

@Module({ imports: [AuthModule], controllers: [PushController] })
export class PushModule {}
