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
    const metricRoute = `${method} ${routePath}`;

    const record = (statusCode: number): void => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.metrics.record(metricRoute, durationMs, statusCode);
    };

    return next.handle().pipe(
      tap(() => {
        record(Number(response?.statusCode ?? 200));
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
}
