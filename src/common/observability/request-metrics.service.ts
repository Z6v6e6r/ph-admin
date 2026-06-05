import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

interface RouteMetricsWindow {
  count: number;
  errorCount: number;
  durationsMs: number[];
  statuses: Map<number, number>;
  maxHeapUsedBytes: number;
  maxHeapTotalBytes: number;
  maxRssBytes: number;
  maxExternalBytes: number;
  maxHeapDeltaBytes: number;
  itemCountTotal: number;
  itemCountSamples: number;
  maxItemCount: number;
}

interface RequestMetricsSample {
  externalBytes?: number;
  heapDeltaBytes?: number;
  heapTotalBytes?: number;
  heapUsedBytes?: number;
  itemCount?: number;
  rssBytes?: number;
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

  record(
    route: string,
    durationMs: number,
    statusCode: number,
    sample: RequestMetricsSample = {}
  ): void {
    const existing =
      this.metrics.get(route) ??
      ({
        count: 0,
        errorCount: 0,
        durationsMs: [],
        statuses: new Map<number, number>(),
        maxHeapUsedBytes: 0,
        maxHeapTotalBytes: 0,
        maxRssBytes: 0,
        maxExternalBytes: 0,
        maxHeapDeltaBytes: 0,
        itemCountTotal: 0,
        itemCountSamples: 0,
        maxItemCount: 0
      } as RouteMetricsWindow);

    existing.count += 1;
    if (statusCode >= 400) {
      existing.errorCount += 1;
    }
    existing.durationsMs.push(Math.max(0, Number(durationMs.toFixed(2))));
    existing.statuses.set(statusCode, (existing.statuses.get(statusCode) ?? 0) + 1);
    existing.maxHeapUsedBytes = Math.max(existing.maxHeapUsedBytes, sample.heapUsedBytes ?? 0);
    existing.maxHeapTotalBytes = Math.max(existing.maxHeapTotalBytes, sample.heapTotalBytes ?? 0);
    existing.maxRssBytes = Math.max(existing.maxRssBytes, sample.rssBytes ?? 0);
    existing.maxExternalBytes = Math.max(existing.maxExternalBytes, sample.externalBytes ?? 0);
    existing.maxHeapDeltaBytes = Math.max(
      existing.maxHeapDeltaBytes,
      sample.heapDeltaBytes ?? 0
    );
    if (Number.isFinite(sample.itemCount)) {
      const itemCount = Math.max(0, Math.floor(Number(sample.itemCount)));
      existing.itemCountTotal += itemCount;
      existing.itemCountSamples += 1;
      existing.maxItemCount = Math.max(existing.maxItemCount, itemCount);
    }
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
          avgItemCount:
            window.itemCountSamples > 0
              ? Number((window.itemCountTotal / window.itemCountSamples).toFixed(2))
              : undefined,
          maxItemCount: window.itemCountSamples > 0 ? window.maxItemCount : undefined,
          maxHeapUsedMb: this.bytesToMb(window.maxHeapUsedBytes),
          maxHeapTotalMb: this.bytesToMb(window.maxHeapTotalBytes),
          maxRssMb: this.bytesToMb(window.maxRssBytes),
          maxExternalMb: this.bytesToMb(window.maxExternalBytes),
          maxHeapDeltaMb: this.bytesToMb(window.maxHeapDeltaBytes),
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

  private bytesToMb(value: number): number {
    return Number((Math.max(0, value) / 1024 / 1024).toFixed(2));
  }
}
