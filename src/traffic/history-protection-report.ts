import { promises as fs } from 'node:fs';
import { isAbsolute } from 'node:path';
import { canonicalIp } from './history-protection';

// This optional report must never make the existing quarantine API unavailable.
export async function readHistoryProtectionReport(path?: string, now = Date.now()) {
  if (!path) return { state: 'not_configured' };
  if (!isAbsolute(path)) return { state: 'invalid' };
  try {
    if ((await fs.stat(path)).size > 1_000_000) return { state: 'invalid' };
    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    const time = Date.parse(raw.checkedAt);
    if (raw.version !== 1 || !['off', 'shadow', 'enforce'].includes(raw.mode) ||
        !Number.isFinite(time) || time > now + 30_000 || !Array.isArray(raw.candidates) || raw.candidates.length > 100) return { state: 'invalid' };
    const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0;
    const counters = Object.fromEntries(['observed', 'wouldLimit', 'limited', 'cacheHits', 'cacheMisses', 'coalesced',
      'identityUnavailable', 'identityResolverErrors', 'capacityFallback', 'telemetryErrors', 'aborted', 'captureTimeouts'].map(k => [k, count(raw.counters?.[k])]));
    const candidates = raw.candidates.filter((x: any) => x && typeof x.ip === 'string' && canonicalIp(x.ip) === x.ip && x.ip !== '188.127.235.140').map((x: any) => ({
      ip: x.ip, requests: count(x.requests), distinctTournaments: count(x.distinctTournaments), distinctCapped: x.distinctCapped === true,
      peakPerMinute: count(x.peakPerMinute), errors: count(x.errors), aborted: count(x.aborted), slow: count(x.slow), maxMs: count(x.maxMs),
      reasons: Array.isArray(x.reasons) ? x.reasons.filter((r: unknown) => ['broad_scan', 'request_spike', 'upstream_errors', 'slow_responses', 'aborted_requests'].includes(String(r))) : []
    }));
    return { state: now - time >= 90_000 ? 'stale' : 'ok', checkedAt: new Date(time).toISOString(),
      mode: raw.mode as string, cacheEnabled: raw.cacheEnabled === true, cacheTtlMs: count(raw.cacheTtlMs),
      accountLimiterConfigured: raw.accountLimiterConfigured === true, counters, candidates };
  } catch (error) {
    return { state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable' };
  }
}
