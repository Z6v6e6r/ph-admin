#!/usr/bin/env node

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_TIMEOUT_MS = 5000;

function printHelp() {
  console.log(`Usage:
  PHAB_BASE_URL=https://padlhub.su npm run postcheck:viva-shadow

Environment:
  PHAB_BASE_URL                  API origin, default ${DEFAULT_BASE_URL}
  PHAB_ADMIN_TOKEN               Optional Bearer token for protected debug endpoints
  PHAB_STAFF_COOKIE              Optional Cookie header for protected debug endpoints
  PHAB_POSTCHECK_TIMEOUT_MS      Request timeout, default ${DEFAULT_TIMEOUT_MS}
  PHAB_SHADOW_EXPECT_READ_MODEL  Expected VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL, default false
  PHAB_SHADOW_EXPECT_REFRESH     Expected VIVA_TOURNAMENT_SNAPSHOT_ENABLED, default true
  PHAB_SHADOW_EXPECT_REFERENCE_CACHE Expected VIVA_REFERENCE_CACHE_ENABLED, default false
  PHAB_SHADOW_EXPECT_GOVERNOR    Expected VIVA_GOVERNOR_ENABLED, default false
  PHAB_SHADOW_POSTCHECK_STRICT   true to fail on auth/skipped debug checks
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const baseUrl = normalizeBaseUrl(process.env.PHAB_BASE_URL) ?? DEFAULT_BASE_URL;
const timeoutMs = readPositiveNumberEnv('PHAB_POSTCHECK_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
const strict = readBooleanEnv('PHAB_SHADOW_POSTCHECK_STRICT', false);
const expectedReadModel = readBooleanEnv('PHAB_SHADOW_EXPECT_READ_MODEL', false);
const expectedRefresh = readBooleanEnv('PHAB_SHADOW_EXPECT_REFRESH', true);
const expectedReferenceCache = readBooleanEnv('PHAB_SHADOW_EXPECT_REFERENCE_CACHE', false);
const expectedGovernor = readBooleanEnv('PHAB_SHADOW_EXPECT_GOVERNOR', false);
const authHeaders = buildAuthHeaders();

const checks = [
  {
    name: 'health',
    path: '/api/health',
    protected: false,
    validate: (payload) => payload?.status === 'ok' || payload?.status === 'OK'
  },
  {
    name: 'public_tournaments_list',
    path: '/api/tournaments/public/list?limit=1',
    protected: false,
    validate: (payload) =>
      payload
      && typeof payload.generatedAt === 'string'
      && typeof payload.count === 'number'
      && Array.isArray(payload.items)
  },
  {
    name: 'viva_snapshot',
    path: '/api/tournaments/debug/viva-snapshot',
    protected: true,
    validate: (payload) =>
      payload
      && payload.refreshEnabled === expectedRefresh
      && payload.readModelEnabled === expectedReadModel
  },
  {
    name: 'viva_reference_cache',
    path: '/api/tournaments/debug/viva-reference-cache',
    protected: true,
    validate: (payload) =>
      payload
      && payload.enabled === expectedReferenceCache
      && typeof payload.inFlightCount === 'number'
      && Array.isArray(payload.entries)
  },
  {
    name: 'viva_governor',
    path: '/api/tournaments/debug/viva-governor',
    protected: true,
    validate: (payload) =>
      payload
      && payload.enabled === expectedGovernor
      && typeof payload.inFlightCount === 'number'
      && Array.isArray(payload.circuits)
  }
];

const startedAt = new Date().toISOString();
const results = [];

for (const check of checks) {
  results.push(await runCheck(check));
}

const failed = results.filter((result) => result.status === 'fail');
const skipped = results.filter((result) => result.status === 'skipped');
const summary = {
  startedAt,
  completedAt: new Date().toISOString(),
  baseUrl,
  expected: {
    snapshotRefreshEnabled: expectedRefresh,
    snapshotReadModelEnabled: expectedReadModel,
    referenceCacheEnabled: expectedReferenceCache,
    governorEnabled: expectedGovernor
  },
  ok: failed.length === 0 && (!strict || skipped.length === 0),
  failedCount: failed.length,
  skippedCount: skipped.length,
  results
};

console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) {
  process.exitCode = 1;
}

async function runCheck(check) {
  const url = new URL(check.path, `${baseUrl}/`).toString();
  const headers = {
    Accept: 'application/json',
    ...(check.protected ? authHeaders : {})
  };
  if (check.protected && Object.keys(authHeaders).length === 0) {
    return {
      name: check.name,
      url,
      status: strict ? 'fail' : 'skipped',
      reason: 'protected endpoint requires PHAB_ADMIN_TOKEN or PHAB_STAFF_COOKIE'
    };
  }

  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const durationMs = Date.now() - started;
    const text = await response.text();
    const payload = parseJson(text);
    if (!response.ok) {
      return {
        name: check.name,
        url,
        status: response.status === 401 || response.status === 403 ? (strict ? 'fail' : 'skipped') : 'fail',
        httpStatus: response.status,
        durationMs,
        reason: truncate(text || response.statusText, 500)
      };
    }
    const valid = check.validate(payload);
    return {
      name: check.name,
      url,
      status: valid ? 'ok' : 'fail',
      httpStatus: response.status,
      durationMs,
      ...(valid ? {} : { reason: 'payload validation failed', payload: summarizePayload(payload) })
    };
  } catch (error) {
    return {
      name: check.name,
      url,
      status: 'fail',
      durationMs: Date.now() - started,
      reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    };
  }
}

function buildAuthHeaders() {
  const headers = {};
  const token = normalizeString(process.env.PHAB_ADMIN_TOKEN);
  const cookie = normalizeString(process.env.PHAB_STAFF_COOKIE);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (cookie) {
    headers.Cookie = cookie;
  }
  return headers;
}

function parseJson(text) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  const summary = {};
  for (const key of Object.keys(payload).slice(0, 20)) {
    const value = payload[key];
    if (Array.isArray(value)) {
      summary[key] = { type: 'array', length: value.length };
    } else if (value && typeof value === 'object') {
      summary[key] = { type: 'object', keys: Object.keys(value).slice(0, 10) };
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

function truncate(value, limit) {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function normalizeBaseUrl(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.replace(/\/+$/, '') : undefined;
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function readPositiveNumberEnv(name, fallback) {
  const parsed = Number(process.env[name] ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function readBooleanEnv(name, fallback) {
  const raw = normalizeString(process.env[name])?.toLowerCase();
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
