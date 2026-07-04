import { Injectable, Logger, Optional } from '@nestjs/common';

export type VivaRequestPriority = 'catalog' | 'detail' | 'reference' | 'command';

export interface VivaGovernedRequestOptions<T> {
  key: string;
  bucket: string;
  priority?: VivaRequestPriority;
  execute: () => Promise<T>;
}

interface VivaCircuitState {
  failures: number;
  openUntil: number;
  lastError?: string;
  lastFailureAt?: string;
}

type ErrorWithStatus = Error & {
  status?: number;
  retryAfterMs?: number;
};

export class VivaCircuitOpenError extends Error {
  constructor(
    readonly bucket: string,
    readonly openUntil: number,
    readonly lastError?: string
  ) {
    super(`Viva circuit is open for ${bucket} until ${new Date(openUntil).toISOString()}`);
    this.name = 'VivaCircuitOpenError';
  }
}

@Injectable()
export class VivaRequestGovernorService {
  private readonly logger = new Logger(VivaRequestGovernorService.name);
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly circuits = new Map<string, VivaCircuitState>();
  private readonly failureThreshold = this.readPositiveNumberEnv(
    'VIVA_GOVERNOR_CIRCUIT_FAILURE_THRESHOLD',
    3
  );
  private readonly cooldownMs = this.readPositiveNumberEnv(
    'VIVA_GOVERNOR_CIRCUIT_COOLDOWN_MS',
    60_000
  );

  constructor(@Optional() private readonly now: () => number = () => Date.now()) {}

  async run<T>(options: VivaGovernedRequestOptions<T>): Promise<T> {
    const key = String(options.key || '').trim();
    const bucket = String(options.bucket || 'viva:default').trim();
    if (!key) {
      return options.execute();
    }

    this.assertCircuitAllows(bucket);

    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const request = options.execute()
      .then((result) => {
        this.recordSuccess(bucket);
        return result;
      })
      .catch((error: unknown) => {
        this.recordFailure(bucket, error);
        throw error;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, request);
    return request;
  }

  getDiagnostics(): {
    inFlightCount: number;
    circuits: Array<{
      bucket: string;
      failures: number;
      openUntil?: string;
      lastError?: string;
      lastFailureAt?: string;
    }>;
  } {
    const now = this.now();
    return {
      inFlightCount: this.inFlight.size,
      circuits: Array.from(this.circuits.entries())
        .map(([bucket, state]) => ({
          bucket,
          failures: state.failures,
          ...(state.openUntil > now ? { openUntil: new Date(state.openUntil).toISOString() } : {}),
          ...(state.lastError ? { lastError: state.lastError } : {}),
          ...(state.lastFailureAt ? { lastFailureAt: state.lastFailureAt } : {})
        }))
        .sort((left, right) => left.bucket.localeCompare(right.bucket))
    };
  }

  private assertCircuitAllows(bucket: string): void {
    const state = this.circuits.get(bucket);
    if (!state || state.openUntil <= this.now()) {
      return;
    }
    throw new VivaCircuitOpenError(bucket, state.openUntil, state.lastError);
  }

  private recordSuccess(bucket: string): void {
    const state = this.circuits.get(bucket);
    if (!state) {
      return;
    }
    this.circuits.delete(bucket);
  }

  private recordFailure(bucket: string, error: unknown): void {
    if (!this.isTransientFailure(error)) {
      return;
    }

    const previous = this.circuits.get(bucket);
    const failures = (previous?.failures ?? 0) + 1;
    const retryAfterMs = this.readRetryAfterMs(error);
    const shouldOpen = failures >= this.failureThreshold || retryAfterMs !== undefined;
    const openUntil = shouldOpen
      ? this.now() + Math.max(retryAfterMs ?? 0, this.cooldownMs)
      : 0;
    const lastError = this.formatError(error);
    const state: VivaCircuitState = {
      failures,
      openUntil,
      lastError,
      lastFailureAt: new Date(this.now()).toISOString()
    };

    this.circuits.set(bucket, state);
    if (shouldOpen && (!previous || previous.openUntil <= this.now())) {
      this.logger.warn(
        JSON.stringify({
          type: 'viva_circuit_open',
          bucket,
          failures,
          openUntil: new Date(openUntil).toISOString(),
          lastError
        })
      );
    }
  }

  private isTransientFailure(error: unknown): boolean {
    const status = this.readStatus(error);
    if (status === 429 || (status !== undefined && status >= 500)) {
      return true;
    }
    const text = this.formatError(error).toLowerCase();
    return text.includes('timeout')
      || text.includes('aborted due to timeout')
      || text.includes('econnreset')
      || text.includes('socket hang up');
  }

  private readStatus(error: unknown): number | undefined {
    const status = (error as ErrorWithStatus | undefined)?.status;
    return Number.isFinite(status) ? Number(status) : undefined;
  }

  private readRetryAfterMs(error: unknown): number | undefined {
    const retryAfterMs = (error as ErrorWithStatus | undefined)?.retryAfterMs;
    if (typeof retryAfterMs !== 'number' || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
      return undefined;
    }
    return Math.floor(retryAfterMs);
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  }

  private readPositiveNumberEnv(name: string, fallback: number): number {
    const raw = Number(process.env[name] ?? '');
    if (!Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }
    return Math.floor(raw);
  }
}
