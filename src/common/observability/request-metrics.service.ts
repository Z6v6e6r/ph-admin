import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

interface RouteMetricsWindow {
  count: number;
  errorCount: number;
  durationsMs: number[];
  statuses: Map<number, number>;
}

@Injectable()
export class RequestMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RequestMetricsService.name);
  private readonly metrics = new Map<string, RouteMetricsWindow>();
  private timer?: ReturnType<typeof setInterval>;

  onModuleInit(): void {
    const intervalMs = this.resolveLogIntervalMs();
    if (intervalMs <= 0) {
      this.logger.log('HTTP metrics logging disabled (HTTP_METRICS_LOG_INTERVAL_MS=0).');
      return;
    }

    this.timer = setInterval(() => {
      this.flush();
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  record(route: string, durationMs: number, statusCode: number): void {
    const existing =
      this.metrics.get(route) ??
      ({
        count: 0,
        errorCount: 0,
        durationsMs: [],
        statuses: new Map<number, number>()
      } as RouteMetricsWindow);

    existing.count += 1;
    if (statusCode >= 400) {
      existing.errorCount += 1;
    }
    existing.durationsMs.push(Math.max(0, Number(durationMs.toFixed(2))));
    existing.statuses.set(statusCode, (existing.statuses.get(statusCode) ?? 0) + 1);
    this.metrics.set(route, existing);
  }

  private resolveLogIntervalMs(): number {
    const raw = Number(process.env.HTTP_METRICS_LOG_INTERVAL_MS ?? 60000);
    if (!Number.isFinite(raw) || raw < 0) {
      return 60000;
    }
    if (raw === 0) {
      return 0;
    }
    return Math.max(10000, Math.floor(raw));
  }

  private flush(): void {
    if (this.metrics.size === 0) {
      return;
    }

    for (const [route, window] of this.metrics.entries()) {
      if (window.count === 0) {
        continue;
      }

      const sorted = [...window.durationsMs].sort((left, right) => left - right);
      const p50 = this.pickPercentile(sorted, 0.5);
      const p95 = this.pickPercentile(sorted, 0.95);
      const max = sorted[sorted.length - 1] ?? 0;
      const statuses = Array.from(window.statuses.entries()).reduce<Record<string, number>>(
        (acc, [statusCode, count]) => {
          acc[String(statusCode)] = count;
          return acc;
        },
        {}
      );

      this.logger.log(
        JSON.stringify({
          type: 'http_route_metrics',
          route,
          count: window.count,
          errorCount: window.errorCount,
          errorRate: Number((window.errorCount / window.count).toFixed(4)),
          p50Ms: p50,
          p95Ms: p95,
          maxMs: max,
          statuses
        })
      );
    }

    this.metrics.clear();
  }

  private pickPercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) {
      return 0;
    }

    const normalized = Math.min(1, Math.max(0, percentile));
    const index = Math.max(0, Math.ceil(sortedValues.length * normalized) - 1);
    return sortedValues[index] ?? sortedValues[sortedValues.length - 1] ?? 0;
  }
}
