import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { RequestMetricsService } from './request-metrics.service';

@Injectable()
export class RequestMetricsInterceptor implements NestInterceptor {
  private readonly subscriptionRoutes = new Set([
    '/api/internal/subscriptions/shadow-quote',
    '/api/internal/subscriptions/entitlements/reserve',
    '/api/internal/subscriptions/entitlements/confirm',
    '/api/internal/subscriptions/entitlements/release',
    '/api/internal/subscriptions/runtime-context',
    '/api/internal/subscriptions/sale-readiness',
    '/api/internal/subscriptions/activate-first-use',
    '/internal/subscriptions/shadow-quote',
    '/internal/subscriptions/entitlements/reserve',
    '/internal/subscriptions/entitlements/confirm',
    '/internal/subscriptions/entitlements/release',
    '/internal/subscriptions/runtime-context',
    '/internal/subscriptions/sale-readiness',
    '/internal/subscriptions/activate-first-use'
  ]);

  constructor(private readonly metrics: RequestMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<{ method?: string; originalUrl?: string; url?: string; route?: { path?: string }; baseUrl?: string }>();
    const response = http.getResponse<{ statusCode?: number }>();

    const routePath = this.resolveRoutePath(request);
    if (!this.shouldTrackRoute(routePath)) {
      return next.handle();
    }

    const method = String(request?.method ?? 'GET').toUpperCase();
    const startedAt = process.hrtime.bigint();
    const memoryBefore = process.memoryUsage();
    const metricRoute = `${method} ${routePath}`;

    const record = (statusCode: number, value?: unknown): void => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const memoryAfter = process.memoryUsage();
      this.metrics.record(metricRoute, durationMs, statusCode, {
        rssBytes: memoryAfter.rss,
        heapUsedBytes: memoryAfter.heapUsed,
        heapTotalBytes: memoryAfter.heapTotal,
        externalBytes: memoryAfter.external,
        heapDeltaBytes: Math.max(0, memoryAfter.heapUsed - memoryBefore.heapUsed),
        itemCount: this.resolveResponseItemCount(value)
      });
    };

    return next.handle().pipe(
      tap((value) => {
        record(Number(response?.statusCode ?? 200), value);
      }),
      catchError((error: unknown) => {
        const statusCode =
          error instanceof HttpException ? error.getStatus() : Number(response?.statusCode ?? 500);
        record(statusCode);
        return throwError(() => error);
      })
    );
  }

  private resolveRoutePath(request: {
    originalUrl?: string;
    url?: string;
    route?: { path?: string };
    baseUrl?: string;
  }): string {
    const routeTemplate = String(request?.route?.path ?? '').trim();
    const baseUrl = String(request?.baseUrl ?? '').trim();
    const routedPath = routeTemplate ? `${baseUrl}${routeTemplate}` : '';
    const fallback = String(request?.originalUrl ?? request?.url ?? '').trim();
    const [pathOnly] = fallback.split('?');
    if (this.subscriptionRoutes.has(routedPath)) return routedPath;
    if (this.subscriptionRoutes.has(pathOnly)) return pathOnly;
    return routedPath || pathOnly || '/';
  }

  private shouldTrackRoute(path: string): boolean {
    return (
      path.startsWith('/api/messenger') ||
      path.startsWith('/api/support') ||
      path.startsWith('/messenger') ||
      path.startsWith('/support') ||
      this.subscriptionRoutes.has(path)
    );
  }

  private resolveResponseItemCount(value: unknown): number | undefined {
    if (Array.isArray(value)) {
      return value.length;
    }
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const candidateKeys = ['dialogs', 'messages', 'threads', 'items', 'results', 'data'];
    for (const key of candidateKeys) {
      if (Array.isArray(record[key])) {
        return (record[key] as unknown[]).length;
      }
    }

    return undefined;
  }
}
