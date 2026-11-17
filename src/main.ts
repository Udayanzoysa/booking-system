import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { frontendCors } from './http-options';
import { PrismaExceptionFilter } from './prisma/prisma-exception.filter';

async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors(frontendCors());
  app.enableShutdownHooks();
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost)));
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  }));
  await app.listen(port, process.env.HOST ?? '127.0.0.1');
}

void bootstrap().catch(() => {
  Logger.error('Backend startup failed. Check the environment and PostgreSQL connection.', 'Bootstrap');
  process.exitCode = 1;
});
