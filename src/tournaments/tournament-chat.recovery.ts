import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TournamentChatService } from './tournament-chat.service';

@Injectable()
export class TournamentChatRecovery implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TournamentChatRecovery.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = false;
  readonly metrics = { ticks: 0, failed: 0 };
  constructor(private readonly service: TournamentChatService) {}
  onModuleInit() {
    // Independent from new-send enablement: disabling sends must never abandon accepted custody.
    if (process.env.TOURNAMENT_CHAT_RECOVERY_ENABLED !== 'true') return;
    this.timer = setInterval(() => { void this.tick(); }, 15000);
    this.timer.unref();
  }
  async tick(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = (async () => {
      this.metrics.ticks++;
      try { const r = await this.service.recoveryTick(); if (r.failed) { this.metrics.failed += r.failed; this.logger.warn('TOURNAMENT_CHAT_RECOVERY_PARTIAL'); } }
      catch { this.metrics.failed++; this.logger.warn('TOURNAMENT_CHAT_RECOVERY_UNAVAILABLE'); }
    })();
    try { await this.running; } finally { this.running = undefined; }
  }
  async onModuleDestroy() { this.stopped = true; if (this.timer) clearInterval(this.timer); await this.running; }
}
