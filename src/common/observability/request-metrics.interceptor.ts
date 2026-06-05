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
    if (routeTemplate) {
      return `${baseUrl}${routeTemplate}`;
    }

    const fallback = String(request?.originalUrl ?? request?.url ?? '').trim();
    const [pathOnly] = fallback.split('?');
    return pathOnly || '/';
  }

  private shouldTrackRoute(path: string): boolean {
    return (
      path.startsWith('/api/messenger') ||
      path.startsWith('/api/support') ||
      path.startsWith('/messenger') ||
      path.startsWith('/support')
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
