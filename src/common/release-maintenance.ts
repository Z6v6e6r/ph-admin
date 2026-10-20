import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const maintenanceStartupGates = {
  NODE_ENV: 'production',
  QUICK_REPLIES_NO_REPLY_SWEEP_ENABLED: 'false',
  SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS: '0',
  PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED: 'false',
  SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED: 'false',
  TOURNAMENTS_VIVA_STATUS_SYNC_RUN_ON_STARTUP: 'false',
  TOURNAMENTS_VIVA_STATUS_SYNC_INTERVAL_MS: '0',
  VIVA_TOURNAMENT_SNAPSHOT_ENABLED: 'false',
  VIVA_TOURNAMENT_SNAPSHOT_PUBLIC_REVALIDATION_ENABLED: 'false',
  VIVA_REFERENCE_CACHE_ENABLED: 'false'
} as const;

export function releaseMaintenanceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = String(env.PHAB_RELEASE_MAINTENANCE_ENABLED ?? 'false').trim().toLowerCase();
  if (mode !== 'true' && mode !== 'false') {
    throw new Error('RELEASE_MAINTENANCE_CONFIGURATION:PHAB_RELEASE_MAINTENANCE_ENABLED');
  }
  if (mode === 'false') return false;
  for (const [key, expected] of Object.entries(maintenanceStartupGates)) {
    if (String(env[key] ?? '').trim().toLowerCase() !== expected) {
      throw new Error(`RELEASE_MAINTENANCE_CONFIGURATION:${key}`);
    }
  }
  return true;
}

export function releaseMaintenanceFence(): RequestHandler {
  const allowedPaths = new Set([
    '/api/health',
    '/api/auth/me',
    '/api/ui/admin',
    '/api/client-script/admin-panel.js',
    '/api/client-script/gift-certificates-admin.js',
    '/api/client-script/referral-links-admin.js'
  ]);
  return (request, response, next) => {
    response.setHeader('X-Phab-Release-Mode', 'maintenance');
    response.setHeader('X-Correlation-Id', randomUUID());
    response.setHeader('Cache-Control', 'no-store');
    const path = (request.originalUrl || request.url).split('?')[0];
    if ((request.method === 'GET' || request.method === 'HEAD') && allowedPaths.has(path)) {
      next();
      return;
    }
    response.status(503).json({
      statusCode: 503,
      code: 'RELEASE_MAINTENANCE',
      message: 'CUP is temporarily in maintenance mode'
    });
  };
}
