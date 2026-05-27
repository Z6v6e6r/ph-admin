import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';

type VivaTournamentSyncTrigger = 'startup' | 'interval';
type VivaTournamentSyncRunStatus = 'SUCCESS' | 'ERROR' | 'SKIPPED';

interface VivaTournamentSyncResultSnapshot {
  windowStart: string;
  windowEnd: string;
  candidatesCount: number;
  checkedCount: number;
  updatedCount: number;
  sourceNotFoundCount: number;
  sourceNotCanceledCount: number;
}

interface VivaTournamentSyncRunLogEntry {
  trigger: VivaTournamentSyncTrigger;
  status: VivaTournamentSyncRunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  message?: string;
  error?: string;
  result?: VivaTournamentSyncResultSnapshot;
}

@Injectable()
export class TournamentsVivaStatusSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TournamentsVivaStatusSyncService.name);
  private readonly intervalMs = this.readNonNegativeNumberEnv(
    'TOURNAMENTS_VIVA_STATUS_SYNC_INTERVAL_MS',
    60 * 60 * 1000
  );
  private readonly forwardDays = this.readPositiveNumberEnv(
    'TOURNAMENTS_VIVA_STATUS_SYNC_FORWARD_DAYS',
    3
  );
  private readonly runOnStartup = this.readBooleanEnv(
    'TOURNAMENTS_VIVA_STATUS_SYNC_RUN_ON_STARTUP',
    true
  );
  private readonly maxRunLogEntries = this.readPositiveNumberEnv(
    'TOURNAMENTS_VIVA_STATUS_SYNC_LOG_LIMIT',
    40
  );
  private timer?: ReturnType<typeof setInterval>;
  private inFlight = false;
  private lastStartedAt?: string;
  private lastCompletedAt?: string;
  private lastDurationMs?: number;
  private lastError?: string;
  private lastRunStatus?: VivaTournamentSyncRunStatus;
  private lastRunMessage?: string;
  private lastResult?: VivaTournamentSyncResultSnapshot;
  private readonly runLog: VivaTournamentSyncRunLogEntry[] = [];

  constructor(private readonly tournamentsService: TournamentsService) {}

  onModuleInit(): void {
    if (this.intervalMs <= 0) {
      this.logEvent({
        status: 'SKIPPED',
        trigger: 'startup',
        message: 'Service disabled by configuration',
        details: {
          intervalMs: this.intervalMs
        }
      });
      return;
    }

    this.logEvent({
      status: 'SUCCESS',
      trigger: 'startup',
      message: 'Service enabled',
      details: {
        intervalMs: this.intervalMs,
        forwardDays: this.forwardDays,
        runOnStartup: this.runOnStartup
      }
    });

    if (this.runOnStartup) {
      setTimeout(() => {
        void this.runSync('startup');
      }, 0);
    }

    this.timer = setInterval(() => {
      void this.runSync('interval');
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  getRuntimeDiagnostics(): {
    enabled: boolean;
    intervalMs: number;
    forwardDays: number;
    runOnStartup: boolean;
    inProgress: boolean;
    lastStartedAt?: string;
    lastCompletedAt?: string;
    lastDurationMs?: number;
    lastError?: string;
    lastRunStatus?: VivaTournamentSyncRunStatus;
    lastRunMessage?: string;
    lastResult?: VivaTournamentSyncResultSnapshot;
    recentRuns: VivaTournamentSyncRunLogEntry[];
  } {
    return {
      enabled: this.intervalMs > 0,
      intervalMs: this.intervalMs,
      forwardDays: this.forwardDays,
      runOnStartup: this.runOnStartup,
      inProgress: this.inFlight,
      lastStartedAt: this.lastStartedAt,
      lastCompletedAt: this.lastCompletedAt,
      lastDurationMs: this.lastDurationMs,
      lastError: this.lastError,
      lastRunStatus: this.lastRunStatus,
      lastRunMessage: this.lastRunMessage,
      lastResult: this.lastResult ? { ...this.lastResult } : undefined,
      recentRuns: this.runLog.map((entry) => ({
        ...entry,
        result: entry.result ? { ...entry.result } : undefined
      }))
    };
  }

  private async runSync(trigger: VivaTournamentSyncTrigger): Promise<void> {
    if (this.inFlight) {
      const message = 'Skipping run because previous sync is still in progress';
      this.lastRunStatus = 'SKIPPED';
      this.lastRunMessage = message;
      this.pushRunLog({
        trigger,
        status: 'SKIPPED',
        startedAt: new Date().toISOString(),
        message
      });
      this.logEvent({
        status: 'SKIPPED',
        trigger,
        message
      });
      return;
    }

    this.inFlight = true;
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    this.lastStartedAt = startedAtIso;
    this.lastError = undefined;
    this.logEvent({
      status: 'SUCCESS',
      trigger,
      message: 'Run started',
      details: {
        startedAt: startedAtIso,
        forwardDays: this.forwardDays
      }
    });

    try {
      const result = await this.tournamentsService.syncCanceledCustomTournamentsFromViva({
        forwardDays: this.forwardDays
      });
      const durationMs = Date.now() - startedAt;
      const completedAt = new Date().toISOString();
      const resultSnapshot: VivaTournamentSyncResultSnapshot = {
        ...result
      };
      const message = `Run completed: updated=${result.updatedCount}, checked=${result.checkedCount}, candidates=${result.candidatesCount}`;

      this.lastCompletedAt = completedAt;
      this.lastDurationMs = durationMs;
      this.lastRunStatus = 'SUCCESS';
      this.lastRunMessage = message;
      this.lastResult = resultSnapshot;
      this.pushRunLog({
        trigger,
        status: 'SUCCESS',
        startedAt: startedAtIso,
        completedAt,
        durationMs,
        message,
        result: resultSnapshot
      });
      this.logEvent({
        status: 'SUCCESS',
        trigger,
        message,
        details: {
          durationMs,
          result: resultSnapshot
        }
      });
    } catch (error) {
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startedAt;
      const errorText = String(error);

      this.lastCompletedAt = completedAt;
      this.lastDurationMs = durationMs;
      this.lastRunStatus = 'ERROR';
      this.lastRunMessage = 'Run failed';
      this.lastError = errorText;
      this.pushRunLog({
        trigger,
        status: 'ERROR',
        startedAt: startedAtIso,
        completedAt,
        durationMs,
        message: 'Run failed',
        error: errorText
      });
      this.logEvent({
        status: 'ERROR',
        trigger,
        message: 'Run failed',
        details: {
          durationMs,
          error: errorText
        }
      });
    } finally {
      this.inFlight = false;
    }
  }

  private pushRunLog(entry: VivaTournamentSyncRunLogEntry): void {
    this.runLog.unshift(entry);
    if (this.runLog.length > this.maxRunLogEntries) {
      this.runLog.length = this.maxRunLogEntries;
    }
  }

  private logEvent(input: {
    status: VivaTournamentSyncRunStatus;
    trigger: VivaTournamentSyncTrigger;
    message: string;
    details?: Record<string, unknown>;
  }): void {
    const payload = JSON.stringify({
      type: 'tournaments_viva_status_sync',
      status: input.status,
      trigger: input.trigger,
      message: input.message,
      ...(input.details ? { details: input.details } : {})
    });
    if (input.status === 'ERROR') {
      this.logger.error(payload);
      return;
    }
    if (input.status === 'SKIPPED') {
      this.logger.warn(payload);
      return;
    }
    this.logger.log(payload);
  }

  private readNonNegativeNumberEnv(name: string, fallback: number): number {
    const raw = Number(process.env[name] ?? fallback);
    if (!Number.isFinite(raw) || raw < 0) {
      return fallback;
    }
    return Math.floor(raw);
  }

  private readPositiveNumberEnv(name: string, fallback: number): number {
    const raw = Number(process.env[name] ?? fallback);
    if (!Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }
    return Math.max(1, Math.floor(raw));
  }

  private readBooleanEnv(name: string, fallback: boolean): boolean {
    const raw = String(process.env[name] ?? '').trim().toLowerCase();
    if (!raw) {
      return fallback;
    }
    if (['1', 'true', 'yes', 'on'].includes(raw)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(raw)) {
      return false;
    }
    return fallback;
  }
}
