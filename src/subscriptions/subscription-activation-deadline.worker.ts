import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SubscriptionActivationService } from './subscription-activation.service';
import { SubscriptionsRepository } from './subscriptions.repository';

@Injectable()
export class SubscriptionActivationDeadlineWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionActivationDeadlineWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private kickoff?: ReturnType<typeof setTimeout>;
  private running = false;
  private cursor: string | null = null;
  private readonly metrics = {
    scanned: 0,
    activated: 0,
    replayed: 0,
    notDue: 0,
    failed: 0,
    overlappingCyclesSkipped: 0
  };

  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly activation: SubscriptionActivationService
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled()) return;
    if (!this.activation.activationEnabled()) {
      throw new Error(
        'SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED requires SUBSCRIPTIONS_ACTIVATION_ENABLED'
      );
    }
    this.intervalMs();
    this.batchSize();
    await this.repository.connect();
    this.kickoff = setTimeout(() => void this.runCycle(), 0);
    this.kickoff.unref?.();
    this.timer = setInterval(() => void this.runCycle(), this.intervalMs());
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.kickoff) clearTimeout(this.kickoff);
    if (this.timer) clearInterval(this.timer);
    this.kickoff = undefined;
    this.timer = undefined;
  }

  async runCycle(): Promise<void> {
    if (!this.enabled()) return;
    if (this.running) {
      this.metrics.overlappingCyclesSkipped += 1;
      return;
    }
    this.running = true;
    const before = JSON.stringify(this.metrics);
    try {
      await this.repository.connect();
      const batchSize = this.batchSize();
      const instances = await this.repository.runtimePendingActivationInstances(
        this.cursor,
        batchSize
      );
      for (const instance of instances) {
        this.metrics.scanned += 1;
        try {
          const result = await this.activation.activateFixedDeadline(
            instance.subscriptionInstanceId
          );
          if (!result) this.metrics.notDue += 1;
          else if (result.outcome === 'ACTIVATED') this.metrics.activated += 1;
          else this.metrics.replayed += 1;
        } catch {
          this.metrics.failed += 1;
        }
      }
      this.cursor = instances.length === batchSize
        ? instances[instances.length - 1]?.subscriptionInstanceId ?? null
        : null;
    } catch {
      this.metrics.failed += 1;
    } finally {
      this.running = false;
      if (JSON.stringify(this.metrics) !== before) {
        this.logger.log(JSON.stringify({
          type: 'subscription_activation_deadline_metrics',
          ...this.metrics,
          cursorPending: this.cursor !== null
        }));
      }
    }
  }

  metricsSnapshot(): Readonly<typeof this.metrics> & { readonly cursorPending: boolean } {
    return { ...this.metrics, cursorPending: this.cursor !== null };
  }

  private enabled(): boolean {
    return String(process.env.SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED ?? '')
      .trim()
      .toLowerCase() === 'true';
  }

  private intervalMs(): number {
    return this.requiredInteger(
      'SUBSCRIPTIONS_ACTIVATION_DEADLINE_INTERVAL_MS',
      60_000,
      5_000,
      3_600_000
    );
  }

  private batchSize(): number {
    return this.requiredInteger(
      'SUBSCRIPTIONS_ACTIVATION_DEADLINE_BATCH_SIZE',
      50,
      1,
      200
    );
  }

  private requiredInteger(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number
  ): number {
    const raw = String(process.env[name] ?? '').trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} is invalid`);
    }
    return value;
  }
}
