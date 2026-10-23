import { createHmac, randomUUID } from 'node:crypto';
import { createDiagnosticBudget } from './support-diagnostic-budget';
import { performance } from 'node:perf_hooks';
import { sanitizeEvent } from './support-diagnostics-core';

// Separate diagnostic configuration. No timers, DB access, token inspection or provider probes.
export class SupportDiagnostics {
  private readonly contexts = new WeakMap<object, { id: string; started: number }>();
  private observed = 0;
  private failures = 0;
  private readonly budget;
  private suppressed = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly sink: (event: Record<string, unknown>) => void = () => {}, private readonly key?: Buffer, limit = 600) {
    this.budget = createDiagnosticBudget(limit);
  }
  link(from: object, to: object): void {
    try {
      let context = this.contexts.get(from);
      if (!context) { context = { id: randomUUID(), started: performance.now() }; this.contexts.set(from, context); }
      this.contexts.set(to, context);
    } catch { this.failures++; }
  }
  private deliver(event: Record<string, unknown>): void {
    try {
      const pending = this.sink(event) as unknown;
      if (pending instanceof Promise) void pending.catch(() => { this.failures++; });
    } catch { this.failures++; }
  }
  flushSuppressed(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    for (const { kind, count } of this.budget.drain()) {
      try {
        const event = sanitizeEvent({ schemaVersion: 1, diagnosticEventId: randomUUID(), eventKind: 'suppression', suppressedEventKind: kind,
          source: 'support_backend', stage: 'collector', code: 'DETAIL_SUPPRESSED', aggregate: true, suppressed: true,
          suppressedCount: count, serverTimeUtc: new Date().toISOString() });
        if (event) this.deliver(event);
      } catch { this.failures++; }
    }
  }
  ref(domain: string, value: unknown): string | undefined {
    try {
    if (!this.key || this.key.length < 32 || typeof value !== 'string' || value.trim().length === 0 || value.length > 1024 || !['binding', 'entity', 'outbox', 'operation'].includes(domain)) return undefined;
    return `h1:${createHmac('sha256', this.key).update(`lk-diagnostics-v1:${domain}\0${value}`).digest('hex').slice(0, 32)}`;
    } catch { return undefined; }
  }
  observe(owner: object, stage: string, fields: Record<string, unknown> = {}): void {
    try {
      if (stage.startsWith('max_') && !['MAX_BOT', 'MAX_ACADEMY_BOT'].includes(String(fields.connector))) return;
      this.observed++;
      let context = this.contexts.get(owner);
      if (!context) { context = { id: randomUUID(), started: performance.now() }; this.contexts.set(owner, context); }
      const event = sanitizeEvent({ ...fields, schemaVersion: 1, diagnosticEventId: randomUUID(), requestId: context.id, eventKind: fields.eventKind ?? 'stage', durationMs: Math.max(0, performance.now() - context.started),
        serverTimeUtc: new Date().toISOString(), source: 'support_backend', stage,
        code: fields.code ?? 'STAGE_ENTER', refUnavailable: !this.key || this.key.length < 32,
        origin: fields.origin ?? 'UNKNOWN', botIdentityKnown: false, accessEvidenceKnown: false,
        serverRelease: process.env.LK_DIAGNOSTICS_SOURCE_RELEASE });
      if (event) {
        if (this.budget.admit(performance.now(), String(event.eventKind))) this.deliver(event);
        else {
          this.suppressed++;
          if (!this.timer) { this.timer = setTimeout(() => this.flushSuppressed(), 1000); this.timer.unref(); }
        }
      }
    } catch { this.failures++; }
  }
  snapshot(): { observed: number; suppressed: number; loggerFailures: number } { return { observed: this.observed, suppressed: this.suppressed, loggerFailures: this.failures }; }
}
// Explicitly opt-in on future rollout. Importing the module never emits or starts a consumer.
export const supportDiagnostics = new SupportDiagnostics(event => {
  if (process.env.LK_DIAGNOSTICS_ENABLED === 'true') console.log(JSON.stringify(event));
}, /^[0-9a-f]{64}$/.test(process.env.LK_DIAGNOSTICS_HMAC_KEY ?? '')
  ? Buffer.from(process.env.LK_DIAGNOSTICS_HMAC_KEY!, 'hex') : undefined);
