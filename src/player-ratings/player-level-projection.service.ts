import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PadlHubPlayerLevelProjectionPayload,
  PlayerRatingStateDocument,
  ratingNumericToGrade
} from './player-ratings.types';
import { PlayerRatingRepository } from './player-ratings.repository';

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RECONCILE_BATCH_SIZE = 100;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 5;
const DEFAULT_CIRCUIT_RESET_MS = 30_000;

@Injectable()
export class PlayerLevelProjectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlayerLevelProjectionService.name);
  private readonly workerId = `cup-level-projection:${randomUUID()}`;
  private readonly enabled = readBoolean(process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED);
  private readonly baseUrl = String(process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_URL ?? '').trim().replace(/\/+$/, '');
  private readonly token = String(process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_TOKEN ?? '').trim();
  private readonly tenantKey = String(process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_TENANT_KEY ?? '').trim();
  private readonly pollIntervalMs = readInteger(process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_POLL_MS, DEFAULT_POLL_INTERVAL_MS, 1_000, 60_000);
  private readonly timeoutMs = readInteger(process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, 500, 30_000);
  private readonly batchSize = readInteger(process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 100);
  private readonly leaseMs = readInteger(process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_LEASE_MS, DEFAULT_LEASE_MS, 10_000, 300_000);
  private readonly circuitFailureThreshold = readInteger(
    process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_CIRCUIT_FAILURE_THRESHOLD,
    DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
    1,
    100
  );
  private readonly circuitResetMs = readInteger(
    process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_CIRCUIT_RESET_MS,
    DEFAULT_CIRCUIT_RESET_MS,
    1_000,
    3_600_000
  );
  private timer?: ReturnType<typeof setInterval>;
  private kickoff?: ReturnType<typeof setTimeout>;
  private running = false;
  private reconcileCursor?: string;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private readonly metrics = {
    attempts: 0,
    applied: 0,
    replayed: 0,
    failed: 0,
    stale: 0,
    circuitSkippedCycles: 0,
    invalidCanonicalStates: 0
  };

  constructor(private readonly repository: PlayerRatingRepository) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    if (!this.baseUrl || !this.token || this.token.length < 32 || !this.tenantKey) {
      throw new Error('PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED requires URL, token and tenant key');
    }
    const target = new URL(this.baseUrl);
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && isLoopback(target.hostname))) {
      throw new Error(
        'PADLHUB_PLAYER_LEVEL_PROJECTION_URL must use https except for explicit loopback development'
      );
    }
    await this.repository.connect();
    this.kickoff = setTimeout(() => void this.runCycle(), 0);
    this.kickoff.unref?.();
    this.timer = setInterval(() => void this.runCycle(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.kickoff) clearTimeout(this.kickoff);
    if (this.timer) clearInterval(this.timer);
    this.kickoff = undefined;
    this.timer = undefined;
  }

  async runCycle(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    const metricsBefore = JSON.stringify(this.metrics);
    try {
      await this.repository.connect();
      await this.reconcileBatch();
      if (this.circuitIsOpen()) {
        this.metrics.circuitSkippedCycles += 1;
        return;
      }
      for (let delivered = 0; delivered < this.batchSize; delivered += 1) {
        if (this.circuitIsOpen()) break;
        const claimed = await this.repository.claimPadlHubProjection({
          leaseOwner: this.workerId,
          now: new Date().toISOString(),
          leaseUntil: new Date(Date.now() + this.leaseMs).toISOString()
        });
        if (!claimed?.inFlight) break;
        await this.deliver(claimed.playerKey, claimed.inFlight, claimed.attempts);
      }
    } catch (error) {
      this.logger.error('PadlHub player-level projection cycle failed', error instanceof Error ? error.stack : undefined);
    } finally {
      this.running = false;
      if (JSON.stringify(this.metrics) !== metricsBefore) {
        this.logger.log(JSON.stringify({
          type: 'padlhub_player_level_projection_metrics',
          ...this.metrics,
          circuitOpen: this.circuitIsOpen()
        }));
      }
    }
  }

  metricsSnapshot(): Readonly<typeof this.metrics> & { readonly circuitOpen: boolean } {
    return { ...this.metrics, circuitOpen: this.circuitIsOpen() };
  }

  private async reconcileBatch(): Promise<void> {
    const states = await this.repository.listStatesForPadlHubReconcile(
      this.reconcileCursor,
      DEFAULT_RECONCILE_BATCH_SIZE
    );
    let invalidCount = 0;
    for (const state of states) {
      const payload = this.payloadFromState(state);
      if (payload) await this.repository.ensurePadlHubProjectionDesired(state, payload);
      else invalidCount += 1;
    }
    if (invalidCount > 0) {
      this.metrics.invalidCanonicalStates += invalidCount;
      this.logger.warn(
        `PadlHub player-level projection skipped ${invalidCount} invalid canonical state(s)`
      );
    }
    this.reconcileCursor = states.length === DEFAULT_RECONCILE_BATCH_SIZE
      ? states[states.length - 1]?.playerKey
      : undefined;
  }

  private payloadFromState(state: PlayerRatingStateDocument): PadlHubPlayerLevelProjectionPayload | null {
    const clientId = String(state.clientId ?? '').trim();
    const expectedGrade = ratingNumericToGrade(state.ratingNumeric);
    if (
      !clientId
      || state.ownership !== 'CUP_CANONICAL'
      || !expectedGrade
      || expectedGrade !== state.rating
      || !state.lastEventId
      || !isProjectionEventType(state.lastEventType)
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      sourceEventId: state.lastEventId,
      sourceRevision: state.padlHubProjectionRevision ?? 0,
      occurredAt: state.lastEventAt,
      player: { externalClientId: clientId },
      sportCode: 'PADEL',
      level: { code: state.rating, numericValue: state.ratingNumeric },
      source: {
        eventType: state.lastEventType,
        formulaVersion: 'padel-rating-grade-v1'
      }
    };
  }

  private async deliver(
    playerKey: string,
    payload: PadlHubPlayerLevelProjectionPayload,
    attempts: number
  ): Promise<void> {
    const now = new Date().toISOString();
    try {
      this.metrics.attempts += 1;
      const response = await fetch(
        `${this.baseUrl}/internal/api/v1/${encodeURIComponent(this.tenantKey)}/player-level-projections`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': payload.sourceEventId,
            'X-Cup-Player-Level-Token': this.token
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: 'error'
        }
      );
      if (response.status !== 200) throw new Error(`PADLHUB_LEVEL_PROJECTION_HTTP_${response.status}`);
      const responseBody: unknown = await response.json().catch(() => null);
      const outcome =
        responseBody && typeof responseBody === 'object' && 'outcome' in responseBody
          ? (responseBody as { outcome?: unknown }).outcome
          : undefined;
      if (outcome === 'stale') {
        this.metrics.stale += 1;
        throw new Error('PADLHUB_LEVEL_PROJECTION_STALE');
      }
      if (outcome !== 'applied' && outcome !== 'replayed') {
        throw new Error('PADLHUB_LEVEL_PROJECTION_RESPONSE_INVALID');
      }
      const completed = await this.repository.completePadlHubProjection({
        playerKey,
        leaseOwner: this.workerId,
        revision: payload.sourceRevision,
        now
      });
      if (!completed) throw new Error('PADLHUB_LEVEL_PROJECTION_LEASE_LOST');
      this.consecutiveFailures = 0;
      this.circuitOpenUntil = 0;
      if (outcome === 'applied') this.metrics.applied += 1;
      else this.metrics.replayed += 1;
    } catch (error) {
      this.metrics.failed += 1;
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.circuitFailureThreshold) {
        this.circuitOpenUntil = Date.now() + this.circuitResetMs;
      }
      const errorCode = sanitizeErrorCode(error);
      const nextAttemptAt = new Date(Date.now() + retryDelayMs(attempts)).toISOString();
      await this.repository.failPadlHubProjection({
        playerKey,
        leaseOwner: this.workerId,
        revision: payload.sourceRevision,
        now,
        nextAttemptAt,
        errorCode
      });
      this.logger.warn(`PadlHub player-level projection retry scheduled: ${errorCode}`);
    }
  }

  private circuitIsOpen(): boolean {
    return this.circuitOpenUntil > Date.now();
  }
}

function readBoolean(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function readInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(8, attempts - 1));
  return Math.min(300_000, 1_000 * 2 ** exponent);
}

function sanitizeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : 'UNKNOWN';
  return /^[A-Z0-9_:-]{1,120}$/.test(message) ? message : 'PADLHUB_LEVEL_PROJECTION_FAILED';
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isProjectionEventType(
  value: string
): value is 'RATING_INITIAL_IMPORTED' | 'RATING_BOOTSTRAPPED_FROM_VIVA' | 'RATING_MANUALLY_CHANGED' {
  return value === 'RATING_INITIAL_IMPORTED'
    || value === 'RATING_BOOTSTRAPPED_FROM_VIVA'
    || value === 'RATING_MANUALLY_CHANGED';
}
