import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AuthPersistenceService } from './auth/auth-persistence.service';
import { AuthService } from './auth/auth.service';
import { releaseMaintenanceEnabled, releaseMaintenanceFence } from './common/release-maintenance';

export async function createApplication(): Promise<INestApplication> {
  const maintenance = releaseMaintenanceEnabled();
  const root = maintenance
    ? (await import('./release-maintenance.module')).ReleaseMaintenanceModule
    : (await import('./app.module')).AppModule;
  const app = await NestFactory.create(root, { bodyParser: false, abortOnError: false });
  if (maintenance) app.use(releaseMaintenanceFence());
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
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 'Authorization', 'Idempotency-Key', 'X-Correlation-Id',
      'X-Subscription-Test-Token', 'x-user-id', 'x-user-login', 'x-user-name',
      'x-user-title', 'x-user-role', 'x-user-roles', 'x-user-phone',
      'x-user-primary-phone', 'x-user-level', 'x-user-level-label', 'x-user-subscriptions',
      'x-user-max-public-url', 'x-padlhub-auth-source', 'x-padlhub-tenant-key',
      'x-connector-route', 'x-connector-routes', 'x-station-id', 'x-station-ids'
    ],
    exposedHeaders: ['X-Correlation-Id', 'Idempotency-Replayed']
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  try {
    if (maintenance) await app.get(AuthPersistenceService).onModuleInit();
    await app.init();
    if (maintenance) {
      const secret = String(process.env.ADMIN_AUTH_SECRET ?? '').trim();
      if (!app.get(AuthService).shouldRequireStaffToken() || !app.get(AuthPersistenceService).isEnabled() ||
          !secret || secret === 'dev-insecure-admin-auth-secret') {
        throw new Error('RELEASE_MAINTENANCE_AUTH_NOT_READY');
      }
    }
    return app;
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}
