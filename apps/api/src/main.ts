import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { carregarConfig } from './config.js';

async function bootstrap(): Promise<void> {
  const config = carregarConfig();
  const app = await NestFactory.create(AppModule.com(config), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // credentials: o cookie HttpOnly de sessão do web (ADR-012) só viaja para origens listadas.
  app.enableCors({ origin: config.CORS_ORIGINS, credentials: true });
  app.enableShutdownHooks();
  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap();
