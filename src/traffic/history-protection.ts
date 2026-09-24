import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { promises as fs } from 'node:fs';
import { isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Request, Response, NextFunction } from 'express';

// Portable: this module has no Nest/Mongo/provider dependency. One owner per Node-RED process.
export interface HistoryProtectionOptions {
  mode?: 'off' | 'shadow' | 'enforce';
  trustLoopbackProxy?: boolean;
  /** A server-side identity established by an earlier authentication middleware, NEVER a header/JWT decode. */
  verifiedSubject?: (request: Request) => string | undefined;
  ratePerMinute?: number;
  burst?: number;
  distinctThreshold?: number;
  spikePerMinute?: number;
  maxSources?: number;
  enableCache?: boolean;
  publicHistoryConfirmed?: boolean;
  cacheTtlMs?: number;
  maxCacheBytes?: number;
  maxEntries?: number;
  maxResponseBytes?: number;
  waitMs?: number;
  captureTimeoutMs?: number;
  now?: () => number;
}
type Bucket = { tokens: number; at: number };
type Minute = { requests: number; errors: number; aborted: number; slow: number; completed: number; maxMs: number };
type Source = Bucket & { seen: number; ids: Map<string, number>; minutes: Map<number, Minute>; limited: number };
type Entry = { body: Buffer; headers: Record<string, string | number | string[]>; expires: number; generation: number };
type Flight = { waiters: Set<(entry?: Entry) => void>; generation: number };
const WINDOW = 600_000;
const PROTECTED = '188.127.235.140';
const PATH = '/lk/tournaments/americano/history';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function integer(value: number | undefined, fallback: number, min: number, max: number) {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('invalid_history_protection_option');
  return n;
}
export function canonicalIp(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.includes('%') || !isIP(raw)) return undefined;
  let ip = isIP(raw) === 6 ? new URL(`http://[${raw}]/`).hostname.slice(1, -1) : raw;
  const mapped = ip.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
  if (mapped) {
    const n = parseInt(mapped[1], 16) * 65536 + parseInt(mapped[2], 16);
    ip = [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join('.');
  }
  return ip;
}
function target(request: Request): URL | undefined {
  try {
    const url = new URL(request.originalUrl || request.url, 'http://history.invalid');
    return decodeURIComponent(url.pathname).replace(/\/$/, '').toLowerCase() === PATH ? url : undefined;
  } catch { return undefined; }
}
function tournamentId(url: URL): string | undefined {
  const values = url.searchParams.getAll('tournamentId');
  return values.length === 1 && /^[a-zA-Z0-9_.:-]{1,128}$/.test(values[0]) ? values[0] : undefined;
}
const SAFE_HEADERS = new Set(['host', 'accept', 'accept-language', 'accept-encoding', 'origin', 'referer',
  'user-agent', 'connection', 'x-real-ip', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
  'x-request-id', 'dnt', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
  'sec-fetch-user', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform']);

export function createHistoryProtection(options: HistoryProtectionOptions = {}) {
  const mode = options.mode ?? 'off';
  if (!['off', 'shadow', 'enforce'].includes(mode)) throw new Error('invalid_history_protection_mode');
  const rate = integer(options.ratePerMinute, 120, 1, 6000);
  const burst = integer(options.burst, 30, 1, 300);
  const distinctThreshold = integer(options.distinctThreshold, 100, 2, 1000);
  const spike = integer(options.spikePerMinute, 500, 2, 10000);
  const maxSources = integer(options.maxSources, 2000, 2, 10000);
  const ttl = integer(options.cacheTtlMs, 2000, 1, 5000);
  const maxCacheBytes = integer(options.maxCacheBytes, 32 * 1024 * 1024, 1, 64 * 1024 * 1024);
  const maxResponseBytes = integer(options.maxResponseBytes, 1024 * 1024, 1, 2 * 1024 * 1024);
  const maxEntries = integer(options.maxEntries, 500, 1, 5000);
  const waitMs = integer(options.waitMs, 2000, 1, 5000);
  const captureTimeoutMs = integer(options.captureTimeoutMs, 5000, 10, 15000);
  // Rate/TTL use a monotonic clock; NTP rollback must not extend a cache or a user's throttle.
  const now = options.now || (() => performance.timeOrigin + performance.now());
  const wallNow = options.now || Date.now;
  const cacheEnabled = mode === 'enforce' && options.enableCache === true && options.publicHistoryConfirmed === true;
  if (options.enableCache && !options.publicHistoryConfirmed) throw new Error('public_history_contract_not_confirmed');
  const sources = new Map<string, Source>();
  const accounts = new Map<string, Bucket>();
  const cache = new Map<string, Entry>();
  const flights = new Map<string, Flight>();
  const ipOverflow: Bucket = { tokens: burst, at: now() };
  const accountOverflow: Bucket = { tokens: burst, at: now() };
  let cacheBytes = 0, generation = 0, writers = 0, lastPrune = 0;
  const counters = { observed: 0, wouldLimit: 0, limited: 0, cacheHits: 0, cacheMisses: 0, coalesced: 0,
    identityUnavailable: 0, identityResolverErrors: 0, capacityFallback: 0, telemetryErrors: 0,
    aborted: 0, captureTimeouts: 0, invalidations: 0 };
  function invalidate() { generation += 1; cache.clear(); cacheBytes = 0; counters.invalidations += 1; }
  function prune(t: number) {
    for (const [ip, source] of sources) {
      if (t - source.seen > WINDOW) { sources.delete(ip); continue; }
      for (const [id, at] of source.ids) if (t - at >= WINDOW) source.ids.delete(id);
      for (const minute of source.minutes.keys()) if (minute < Math.floor((t - WINDOW) / 60000)) source.minutes.delete(minute);
    }
    for (const [key, b] of accounts) if (t - b.at > WINDOW) accounts.delete(key);
    for (const [key, entry] of cache) if (entry.expires <= t) { cache.delete(key); cacheBytes -= entry.body.length; }
    lastPrune = t;
  }
  function consume(bucket: Bucket, t: number) {
    bucket.tokens = Math.min(burst, bucket.tokens + Math.max(0, t - bucket.at) * rate / 60000);
    bucket.at = t;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1; return true;
  }
  function sourceFor(ip: string, t: number) {
    let source = sources.get(ip);
    if (!source && sources.size < maxSources) {
      source = { tokens: burst, at: t, seen: t, ids: new Map(), minutes: new Map(), limited: 0 };
      sources.set(ip, source);
    }
    return source;
  }
  function clientIp(request: Request) {
    const peer = canonicalIp(request.socket.remoteAddress);
    if (options.trustLoopbackProxy && (peer === '127.0.0.1' || peer === '::1')) {
      return canonicalIp(request.headers['x-real-ip']);
    }
    return peer;
  }
  function cacheKey(request: Request, url: URL, id: string | undefined) {
    const raw = request.originalUrl || request.url;
    if (!cacheEnabled || writers || request.method !== 'GET' || !id ||
        raw.split('?')[0] !== PATH || raw.includes('#') ||
        [...url.searchParams.keys()].some(k => k !== 'tournamentId') ||
        Object.keys(request.headers).some(k => !SAFE_HEADERS.has(k)) ||
        request.headers.authorization || request.headers.cookie) return undefined;
    // Origin/host/language/representation boundaries; unknown identity/conditional headers bypass.
    return hash(JSON.stringify([id, request.headers.host, request.headers['x-forwarded-host'], request.headers['x-forwarded-proto'], request.headers.origin,
      request.headers.accept, request.headers['accept-language'], request.headers['accept-encoding']]));
  }
  function send(request: Request, response: Response, entry: Entry) {
    if (response.destroyed || response.writableEnded) return;
    for (const [name, value] of Object.entries(entry.headers)) response.setHeader(name, value);
    response.statusCode = 200; response.end(entry.body);
  }
  function finishFlight(key: string, flight: Flight, entry?: Entry) {
    if (flights.get(key) === flight) flights.delete(key);
    for (const resume of [...flight.waiters]) resume(entry);
    flight.waiters.clear();
  }
  function middleware(request: Request, response: Response, next: NextFunction) {
    if (mode === 'off') return next();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      // Fence all HTTP writers; no inspection/modification of payments, bodies, paths or responses.
      writers += 1; invalidate(); let done = false;
      const release = () => { if (!done) { done = true; writers -= 1; invalidate(); } };
      response.once('finish', release); response.once('close', release);
      return next();
    }
    const url = target(request);
    if (!url || request.method === 'OPTIONS') return next();
    const t = now(); if (t - lastPrune >= 60000) prune(t);
    counters.observed += 1;
    const ip = clientIp(request), id = tournamentId(url);
    if (!ip) { counters.identityUnavailable += 1; return next(); }
    const source = sourceFor(ip, t);
    if (!source) counters.capacityFallback += 1;
    if (source) source.seen = t;
    const minuteKey = Math.floor(t / 60000);
    if (source && !source.minutes.has(minuteKey)) source.minutes.set(minuteKey, { requests: 0, errors: 0, aborted: 0, slow: 0, completed: 0, maxMs: 0 });
    const minute = source?.minutes.get(minuteKey); if (minute) minute.requests += 1;
    if (source && id) {
      const key = hash(id);
      source.ids.delete(key);
      if (source.ids.size >= distinctThreshold + 1) source.ids.delete(source.ids.keys().next().value!);
      source.ids.set(key, t); // Keep recent distinct IDs; cap means a lower bound, never an exact larger total.
    }
    let limited = ip !== PROTECTED && !consume(source || ipOverflow, t);
    if (ip !== PROTECTED && options.verifiedSubject) {
      try {
        const subject = options.verifiedSubject(request);
        if (typeof subject === 'string' && subject && subject.length <= 512) {
          const key = hash(subject);
          if (!accounts.has(key) && accounts.size < maxSources) accounts.set(key, { tokens: burst, at: t });
          const bucket = accounts.get(key);
          if (!bucket) counters.capacityFallback += 1;
          limited = !consume(bucket || accountOverflow, t) || limited;
        }
      } catch { counters.identityResolverErrors += 1; }
    }
    if (ip === PROTECTED) limited = false;
    if (limited) {
      counters.wouldLimit += 1; if (source) source.limited += 1;
      if (mode === 'enforce') {
        counters.limited += 1;
        response.statusCode = 429; response.setHeader('Retry-After', String(Math.ceil(60 / rate)));
        response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end('{"error":"TOO_MANY_REQUESTS"}'); return;
      }
    }
    let measured = false;
    const measure = (completed: boolean) => {
      if (measured) return; measured = true;
      if (!completed) counters.aborted += 1;
      if (!minute) return;
      const elapsed = Math.round(Math.max(0, now() - t));
      minute.completed += Number(completed); minute.errors += Number(completed && response.statusCode >= 500);
      minute.aborted += Number(!completed);
      minute.slow += Number(elapsed >= 2000); minute.maxMs = Math.max(minute.maxMs, elapsed);
    };
    response.once('finish', () => measure(true)); response.once('close', () => measure(false));
    const key = cacheKey(request, url, id);
    if (!key || ip === PROTECTED) return next();
    const cached = cache.get(key);
    if (cached && cached.expires > t && cached.generation === generation) {
      counters.cacheHits += 1; return send(request, response, cached);
    }
    const current = flights.get(key);
    if (current && current.generation === generation && current.waiters.size < 32) {
      let settled = false;
      const resume = (entry?: Entry) => {
        if (settled) return; settled = true; clearTimeout(timer); current.waiters.delete(resume);
        response.removeListener('close', abort);
        if (response.destroyed || response.writableEnded) return;
        if (entry && !writers && entry.generation === generation && entry.expires > now()) {
          counters.coalesced += 1; send(request, response, entry);
        } else next();
      };
      const abort = () => { settled = true; clearTimeout(timer); current.waiters.delete(resume); };
      const timer = setTimeout(() => resume(), waitMs); timer.unref();
      response.once('close', abort); current.waiters.add(resume); return;
    }
    if (flights.size >= 64 || current) return next();
    counters.cacheMisses += 1;
    const flight: Flight = { generation, waiters: new Set() }; flights.set(key, flight);
    let chunks: Buffer[] = [], size = 0, ended = false, overflow = false;
    const write = response.write, end = response.end;
    const capture = (chunk: any, encoding?: any) => {
      if (chunk === undefined || chunk === null || typeof chunk === 'function' || overflow) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding as BufferEncoding : undefined);
      size += buf.length;
      if (size > maxResponseBytes) { overflow = true; chunks = []; } else chunks.push(Buffer.from(buf));
    };
    response.write = function (this: Response, ...args: any[]) { capture(args[0], args[1]); return (write as any).apply(this, args); } as any;
    response.end = function (this: Response, ...args: any[]) { if (!ended) capture(args[0], args[1]); ended = true; return (end as any).apply(this, args); } as any;
    let released = false;
    const captureTimer = setTimeout(() => { counters.captureTimeouts += 1; overflow = true; release(false); }, captureTimeoutMs);
    captureTimer.unref();
    const release = (completed: boolean) => {
      if (released) return; released = true;
      clearTimeout(captureTimer);
      let entry: Entry | undefined;
      const contentType = String(response.getHeader('content-type') || '');
      const controls = String(response.getHeader('cache-control') || '');
      const originTtls = [...controls.matchAll(/(?:^|,)\s*(?:s-maxage|max-age)\s*=\s*"?(\d+)"?/gi)].map(m => Number(m[1]) * 1000);
      const effectiveTtl = Math.min(ttl, ...originTtls);
      if (completed && !overflow && size && response.statusCode === 200 && flight.generation === generation && !writers &&
          effectiveTtl > 0 && !response.getHeader('age') &&
          /application\/json/i.test(contentType) && !/private|no-store|no-cache|(?:s-maxage|max-age)\s*=\s*0\b/i.test(controls) &&
          !response.getHeader('pragma') && !response.getHeader('expires') &&
          !response.getHeader('set-cookie') && !response.getHeader('vary') && !response.getHeader('content-encoding')) {
        const body = Buffer.concat(chunks);
        try {
          JSON.parse(body.toString('utf8'));
          if (body.length <= maxCacheBytes) {
            const headers: Entry['headers'] = {};
            for (const name of ['content-type', 'content-language', 'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-expose-headers']) {
              const value = response.getHeader(name); if (value !== undefined) headers[name] = value;
            }
            // Keep shared responses out of downstream caches; server-side freshness is bounded here.
            headers['cache-control'] = 'no-store';
            entry = { body, headers, expires: now() + effectiveTtl, generation };
            const old = cache.get(key); if (old) { cache.delete(key); cacheBytes -= old.body.length; }
            while (cache.size >= maxEntries || cacheBytes + body.length > maxCacheBytes) {
              const oldest = cache.keys().next().value!; cacheBytes -= cache.get(oldest)!.body.length; cache.delete(oldest);
            }
            cache.set(key, entry); cacheBytes += body.length;
          }
        } catch { /* Non-JSON success remains an unmodified pass-through. */ }
      }
      chunks = []; finishFlight(key, flight, entry);
    };
    response.once('finish', () => release(true)); response.once('close', () => release(false));
    return next();
  }
  function snapshot() {
    const t = now(); prune(t);
    const candidates = [...sources].map(([ip, source]) => {
      const values = [...source.minutes.values()];
      const requests = values.reduce((n, x) => n + x.requests, 0);
      const errors = values.reduce((n, x) => n + x.errors, 0);
      const aborted = values.reduce((n, x) => n + x.aborted, 0);
      const slow = values.reduce((n, x) => n + x.slow, 0);
      const peakPerMinute = Math.max(0, ...values.map(x => x.requests));
      const reasons = [];
      if (source.ids.size > distinctThreshold) reasons.push('broad_scan');
      if (peakPerMinute >= spike) reasons.push('request_spike');
      if (errors >= 10) reasons.push('upstream_errors');
      if (slow >= 10) reasons.push('slow_responses');
      if (aborted >= 10) reasons.push('aborted_requests');
      return { ip, requests, distinctTournaments: source.ids.size, distinctCapped: source.ids.size >= distinctThreshold + 1,
        peakPerMinute, errors, aborted, slow, maxMs: Math.max(0, ...values.map(x => x.maxMs)), reasons,
        protected: ip === PROTECTED, lastSeenAt: new Date(source.seen).toISOString() };
    }).filter(x => x.reasons.length && !x.protected).sort((a, b) => b.requests - a.requests).slice(0, 100);
    return { version: 1, checkedAt: new Date(wallNow()).toISOString(), mode, scope: 'tournament-history',
      windowSeconds: 600, cacheEnabled, cacheTtlMs: ttl, accountLimiterConfigured: Boolean(options.verifiedSubject),
      thresholds: { ratePerMinute: rate, burst, distinctThreshold, spikePerMinute: spike },
      counters: { ...counters }, candidates, state: { sources: sources.size, accounts: accounts.size,
        cacheEntries: cache.size, cacheBytes, flights: flights.size, writers } };
  }
  function startReporting(path: string, everyMs = 15000) {
    if (!isAbsolute(path) || everyMs < 1000) throw new Error('invalid_history_report_target');
    let busy = false, closed = false;
    const publish = async () => {
      if (busy || closed) return; busy = true;
      const temp = path + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temp, JSON.stringify(snapshot()), { mode: 0o640, flag: 'wx' });
        await fs.rename(temp, path);
      } catch { counters.telemetryErrors += 1; await fs.unlink(temp).catch(() => undefined); }
      finally { busy = false; }
    };
    void publish(); const timer = setInterval(() => void publish(), everyMs); timer.unref();
    return () => { closed = true; clearInterval(timer); };
  }
  return { middleware, snapshot, invalidate, startReporting };
}
