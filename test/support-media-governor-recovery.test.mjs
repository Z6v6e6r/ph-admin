import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = process.env.SUPPORT_MEDIA_RECOVERY_ROOT;
assert(root && path.isAbsolute(root), 'Set an owned built recovery tree');
const require = createRequire(path.join(root, 'package.json'));
const { VivaRequestGovernorService, VivaRequestTimeoutError } = require('./dist/integrations/viva/viva-request-governor.service.js');
const { VivaTournamentsService } = require('./dist/integrations/viva/viva-tournaments.service.js');
test('compiled recovery bounds a shared operation and preserves ownership of its replacement', { timeout: 2000 }, async () => {
  const governor = new VivaRequestGovernorService();
  let settleOld, settleNew, executions = 0;
  const options = { key: 'synthetic-recovery-detail', bucket: 'viva:synthetic:recovery', timeoutMs: 15 };
  const first = governor.run({ ...options, execute: () => { executions++; return new Promise(resolve => { settleOld = resolve; }); } });
  const joined = governor.run({ ...options, execute: async () => { executions++; return 'unexpected'; } });
  const results = await Promise.allSettled([first, joined]);
  assert.equal(executions, 1);
  assert(results.every(r => r.status === 'rejected' && r.reason instanceof VivaRequestTimeoutError));
  assert.equal(results[0].reason, results[1].reason);
  assert.equal(governor.getDiagnostics().inFlightCount, 0);
  const replacement = governor.run({ ...options, timeoutMs: 1000, execute: () => new Promise(resolve => { settleNew = resolve; }) });
  await new Promise(resolve => setImmediate(resolve));
  settleOld('obsolete'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(governor.getDiagnostics().inFlightCount, 1);
  settleNew('current'); assert.equal(await replacement, 'current');
  assert.equal(governor.getDiagnostics().inFlightCount, 0);
});
test('compiled recovery aborts a hanging Viva body and permits a fresh request', { timeout: 2000 }, async () => {
  const previousFetch = globalThis.fetch;
  const values = { VIVA_GOVERNOR_ENABLED: 'true', VIVA_END_USER_TIMEOUT_MS: '15',
    VIVA_END_USER_WIDGET_ID: 'synthetic', VIVA_END_USER_API_BASE_URL: 'https://synthetic.invalid' };
  const previous = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  Object.assign(process.env, values);
  let calls = 0, signal;
  globalThis.fetch = async (_url, init) => {
    calls++; signal = init.signal;
    const response = new Response('{}', { status: 200 });
    if (calls === 1) response.json = () => new Promise(() => {});
    return response;
  };
  try {
    const governor = new VivaRequestGovernorService(), service = new VivaTournamentsService(undefined, governor);
    await assert.rejects(service.fetchJson('exercises/synthetic-recovery'), VivaRequestTimeoutError);
    assert.equal(signal.aborted, true);
    assert.equal(governor.getDiagnostics().inFlightCount, 0);
    assert.deepEqual(await service.fetchJson('exercises/synthetic-recovery'), {});
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
