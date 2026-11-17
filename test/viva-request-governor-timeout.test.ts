import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  VivaCircuitOpenError,
  VivaRequestGovernorService,
  VivaRequestTimeoutError
} from '../src/integrations/viva/viva-request-governor.service';
import { VivaTournamentsService } from '../src/integrations/viva/viva-tournaments.service';

const key = 'GET https://viva.example/exercises/synthetic-tournament';
const bucket = 'viva:synthetic:detail';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

// Node's test deadline also makes a regression fail instead of hanging this test process.
test('a nonsettling operation times out, aborts and frees its key', { timeout: 2000 }, async () => {
  const governor = new VivaRequestGovernorService();
  let signal: AbortSignal | undefined;
  await assert.rejects(governor.run({ key, bucket, timeoutMs: 15, execute: async input => {
    signal = input;
    return new Promise<never>(() => undefined); // Deliberately ignores cancellation.
  } }), (error: unknown) => error instanceof VivaRequestTimeoutError && error.timeoutMs === 15);
  assert.equal(signal?.aborted, true);
  assert.equal(governor.getDiagnostics().inFlightCount, 0);
  assert.equal(governor.getDiagnostics().circuits[0]?.failures, 1);
});

test('deduplicated callers share a deadline/failure and a later retry starts anew', { timeout: 2000 }, async () => {
  const governor = new VivaRequestGovernorService();
  let executions = 0;
  const first = governor.run({ key, bucket, timeoutMs: 15, execute: async () => {
    executions++;
    return new Promise<never>(() => undefined);
  } });
  const second = governor.run({ key, bucket, timeoutMs: 1000, execute: async () => {
    executions++;
    return 'duplicate';
  } });
  const results = await Promise.allSettled([first, second]);
  assert.equal(executions, 1);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'rejected');
  if (results[0].status === 'rejected' && results[1].status === 'rejected') {
    assert.ok(results[0].reason instanceof VivaRequestTimeoutError);
    assert.equal(results[0].reason, results[1].reason);
  }
  assert.equal(governor.getDiagnostics().circuits[0]?.failures, 1);
  assert.equal(await governor.run({ key, bucket, execute: async () => { executions++; return 'retry'; } }), 'retry');
  assert.equal(executions, 2);
  assert.equal(governor.getDiagnostics().inFlightCount, 0);
});

for (const settlement of ['resolve', 'reject'] as const) {
  test(`late ${settlement} of an expired operation cannot evict/reset its replacement`, { timeout: 2000 }, async () => {
    const governor = new VivaRequestGovernorService();
    const old = deferred<string>();
    await assert.rejects(governor.run({ key, bucket, timeoutMs: 15, execute: () => old.promise }), VivaRequestTimeoutError);
    const replacement = deferred<string>();
    let duplicateExecutions = 0;
    const retry = governor.run({ key, bucket, timeoutMs: 1000, execute: () => replacement.promise });
    await flush();
    if (settlement === 'resolve') old.resolve('obsolete');
    else old.reject(new Error('obsolete failure'));
    await flush();
    assert.equal(governor.getDiagnostics().inFlightCount, 1);
    assert.equal(governor.getDiagnostics().circuits[0]?.failures, 1);
    const joined = governor.run({ key, bucket, execute: async () => { duplicateExecutions++; return 'wrong'; } });
    replacement.resolve('fresh');
    assert.deepEqual(await Promise.all([retry, joined]), ['fresh', 'fresh']);
    assert.equal(duplicateExecutions, 0);
    assert.equal(governor.getDiagnostics().inFlightCount, 0);
    assert.equal(governor.getDiagnostics().circuits.length, 0);
  });
}

test('a synchronous throw frees the key and retains the original error', { timeout: 2000 }, async () => {
  const governor = new VivaRequestGovernorService();
  const original = new Error('synthetic synchronous failure');
  await assert.rejects(governor.run({ key, bucket, execute: () => { throw original; } }), error => error === original);
  assert.equal(governor.getDiagnostics().inFlightCount, 0);
  assert.equal(await governor.run({ key, bucket, execute: async () => 'recovered' }), 'recovered');
});

test('execution begins after registration, so reentrant same-key callers deduplicate', { timeout: 2000 }, async () => {
  const governor = new VivaRequestGovernorService();
  let inner: Promise<string> | undefined;
  let duplicates = 0;
  const outer = governor.run({ key, bucket, execute: async () => {
    inner = governor.run({ key, bucket, execute: async () => { duplicates++; return 'wrong'; } });
    return 'shared';
  } });
  assert.equal(await outer, 'shared');
  assert.equal(await inner, 'shared');
  assert.equal(duplicates, 0);
});

test('timeouts open the existing circuit once per operation and respect cooldown', { timeout: 2000 }, async () => {
  const previous = process.env.VIVA_GOVERNOR_CIRCUIT_FAILURE_THRESHOLD;
  process.env.VIVA_GOVERNOR_CIRCUIT_FAILURE_THRESHOLD = '2';
  let now = Date.now();
  try {
    const governor = new VivaRequestGovernorService(() => now);
    for (let i = 0; i < 2; i++) {
      await assert.rejects(governor.run({ key, bucket, timeoutMs: 10, execute: () => new Promise<never>(() => undefined) }), VivaRequestTimeoutError);
    }
    let executions = 0;
    await assert.rejects(governor.run({ key, bucket, execute: async () => { executions++; return 'blocked'; } }), VivaCircuitOpenError);
    assert.equal(executions, 0);
    now += 60_001;
    assert.equal(await governor.run({ key, bucket, execute: async () => 'after cooldown' }), 'after cooldown');
  } finally {
    if (previous === undefined) delete process.env.VIVA_GOVERNOR_CIRCUIT_FAILURE_THRESHOLD;
    else process.env.VIVA_GOVERNOR_CIRCUIT_FAILURE_THRESHOLD = previous;
  }
});

test('Viva response-body hang is bounded, receives abort and can be requested again', { timeout: 2000 }, async () => {
  const previousFetch = globalThis.fetch;
  const envNames = ['VIVA_GOVERNOR_ENABLED', 'VIVA_END_USER_TIMEOUT_MS', 'VIVA_END_USER_WIDGET_ID', 'VIVA_END_USER_API_BASE_URL'] as const;
  const previous = envNames.map(name => process.env[name]);
  process.env.VIVA_GOVERNOR_ENABLED = 'true';
  process.env.VIVA_END_USER_TIMEOUT_MS = '15';
  process.env.VIVA_END_USER_WIDGET_ID = 'synthetic';
  process.env.VIVA_END_USER_API_BASE_URL = 'https://viva.example';
  const signals: AbortSignal[] = [];
  let fetches = 0;
  globalThis.fetch = (async (_input, init) => {
    fetches++;
    signals.push(init?.signal as AbortSignal);
    if (fetches === 1) {
      const response = new Response('{}', { status: 200 });
      response.json = () => new Promise<never>(() => undefined);
      return response;
    }
    return new Response(JSON.stringify({ id: 'synthetic-tournament' }), { status: 200 });
  }) as typeof fetch;
  try {
    const governor = new VivaRequestGovernorService();
    const service = new VivaTournamentsService(undefined, governor);
    const fetchJson = (service as unknown as { fetchJson(path: string): Promise<unknown> }).fetchJson.bind(service);
    await assert.rejects(fetchJson('exercises/synthetic-tournament'), VivaRequestTimeoutError);
    assert.equal(signals[0].aborted, true);
    assert.equal(governor.getDiagnostics().inFlightCount, 0);
    assert.deepEqual(await fetchJson('exercises/synthetic-tournament'), { id: 'synthetic-tournament' });
    assert.equal(fetches, 2);
  } finally {
    globalThis.fetch = previousFetch;
    envNames.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  }
});

test('keyless operations also have a deadline without entering the shared map', { timeout: 2000 }, async () => {
  const governor = new VivaRequestGovernorService();
  await assert.rejects(governor.run({ key: '', bucket, timeoutMs: 10, execute: () => new Promise<never>(() => undefined) }), VivaRequestTimeoutError);
  assert.equal(governor.getDiagnostics().inFlightCount, 0);
});
