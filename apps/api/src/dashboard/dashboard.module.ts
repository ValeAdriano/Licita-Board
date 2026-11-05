import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DashboardController } from './dashboard.controller.js';

@Module({ imports: [AuthModule], controllers: [DashboardController] })
export class DashboardModule {}
