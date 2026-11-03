import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { carregarConfig } from './config.js';
import { configurarApp } from './configurar-app.js';

async function bootstrap(): Promise<void> {
  const config = carregarConfig();
  const app = await NestFactory.create(AppModule.com(config), { bufferLogs: true, bodyParser: false });
  app.useLogger(app.get(Logger));
  configurarApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap();
