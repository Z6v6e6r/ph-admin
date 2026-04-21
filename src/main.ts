import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const requestBodyLimit = String(process.env.REQUEST_BODY_LIMIT ?? '20mb').trim() || '20mb';
  app.use(json({ limit: requestBodyLimit }));
  app.use(urlencoded({ extended: true, limit: requestBodyLimit }));
  const trustProxy = String(process.env.TRUST_PROXY ?? '').toLowerCase();
  if (trustProxy === '1' || trustProxy === 'true' || trustProxy === 'yes') {
    const httpAdapter = app.getHttpAdapter();
    if (httpAdapter.getType() === 'express') {
      httpAdapter.getInstance().set('trust proxy', 1);
    }
  }
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-user-id',
      'x-user-login',
      'x-user-name',
      'x-user-title',
      'x-user-role',
      'x-user-roles',
      'x-user-phone',
      'x-user-primary-phone',
      'x-user-level',
      'x-user-level-label',
      'x-user-subscriptions',
      'x-user-max-public-url',
      'x-connector-route',
      'x-connector-routes',
      'x-station-id',
      'x-station-ids'
    ]
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );

  const rawPort = Number(process.env.PORT ?? 3000);
  const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 3000;
  const host = String(process.env.HOST ?? '0.0.0.0').trim() || '0.0.0.0';
  await app.listen(port, host);
}

bootstrap();
