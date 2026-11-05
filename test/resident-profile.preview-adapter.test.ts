import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import {
  HttpResidentPreviewAdapter,
  normalizeApiBaseUrl,
  ResidentPreviewFetch,
  ResidentPreviewFetchInit
} from '../src/residency-check/resident-preview.http.adapter';
import {
  ResidentPreviewError,
  ResidentPreviewRequest
} from '../src/residency-check/residency-check.types';

const VALID_PASS = 'rsp1_' + 'A'.repeat(43);
const STAFF_SESSION = { cookie: 'phab_admin_session=token-1' };
const PREVIEW_PATH = '/api/v1/admin/resident-services/passes/preview';

const previewBody = {
  schemaVersion: 1,
  passId: 'resident_pass:abc',
  state: 'ACTIVE',
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  stationId: 'Piter',
  resident: {
    confirmed: true,
    subscriptionInstanceId: 'subscription_instance:abc-123',
    subscriptionTypeId: 'type-1',
    subscriptionTypeTitle: 'Резидент',
    activeFrom: new Date(Date.now() - 86_400_000).toISOString(),
    activeTo: new Date(Date.now() + 86_400_000).toISOString(),
    homeStationId: 'Piter'
  },
  services: [],
  issuable: true
};

type Captured = { url: string; init: ResidentPreviewFetchInit };

function fakeFetch(
  status: number,
  body: unknown,
  captured: Captured[] = []
): ResidentPreviewFetch {
  return async (url, init) => {
    captured.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        typeof body === 'string' ? body : JSON.stringify(body)
    };
  };
}

async function expectPreviewError(
  run: () => Promise<unknown>
): Promise<ResidentPreviewError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof ResidentPreviewError, 'unexpected error: ' + String(error));
    return error;
  }
  assert.fail('expected the preview to fail');
}

function request(overrides: Partial<ResidentPreviewRequest> = {}): ResidentPreviewRequest {
  return {
    passToken: VALID_PASS,
    stationId: 'Piter',
    staffSession: STAFF_SESSION,
    ...overrides
  };
}

async function main(): Promise<void> {
  const previousUrl = process.env.RESIDENCY_CHECK_RESIDENT_SERVICES_URL;
  const previousPort = process.env.PORT;
  delete process.env.RESIDENCY_CHECK_RESIDENT_SERVICES_URL;
  delete process.env.PORT;

  /* -------------------- base URL policy -------------------- */
  assert.equal(normalizeApiBaseUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(normalizeApiBaseUrl('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
  assert.equal(
    normalizeApiBaseUrl('https://api.padlhub.su/internal/'),
    'https://api.padlhub.su/internal'
  );
  for (const invalid of [
    'ftp://api.padlhub.su',
    'https://user:pass@api.padlhub.su',
    'not-a-url',
    'file:///etc/passwd'
  ]) {
    const error = await expectPreviewError(async () => normalizeApiBaseUrl(invalid));
    assert.equal(error.code, 'RESIDENCY_PASS_PREVIEW_URL_INVALID');
    assert.equal(error.failure, 'UNAVAILABLE');
    assert.doesNotMatch(error.message, /passwd|user:pass|not-a-url/);
  }

  /* -------------------- success: minimal evidence, credentials forwarded -------------------- */
  {
    process.env.RESIDENCY_CHECK_RESIDENT_SERVICES_URL = 'https://api.padlhub.su';
    const captured: Captured[] = [];
    const adapter = new HttpResidentPreviewAdapter({
      fetchImpl: fakeFetch(200, previewBody, captured)
    });
    const evidence = await adapter.previewPass(request());
    assert.deepEqual(evidence, {
      passId: 'resident_pass:abc',
      subscriptionInstanceId: 'subscription_instance:abc-123',
      stationId: 'Piter',
      expiresAt: previewBody.expiresAt
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, 'https://api.padlhub.su' + PREVIEW_PATH);
    assert.equal(captured[0].init.method, 'POST');
    assert.equal(captured[0].init.redirect, 'error');
    assert.equal(captured[0].init.headers.cookie, 'phab_admin_session=token-1');
    assert.equal(captured[0].init.headers['content-type'], 'application/json');
    assert.equal(captured[0].init.headers.accept, 'application/json');
    // The token travels in the body only: never in the URL or a header.
    assert.doesNotMatch(captured[0].url, new RegExp(VALID_PASS));
    assert.doesNotMatch(JSON.stringify(captured[0].init.headers), new RegExp(VALID_PASS));
    assert.deepEqual(JSON.parse(captured[0].init.body), {
      token: VALID_PASS,
      stationId: 'Piter'
    });
  }

  {
    // Bearer session forwarded as authorization.
    const captured: Captured[] = [];
    const adapter = new HttpResidentPreviewAdapter({ fetchImpl: fakeFetch(200, previewBody, captured) });
    await adapter.previewPass(
      request({ staffSession: { authorization: 'Bearer staff-jwt' } })
    );
    assert.equal(captured[0].init.headers.authorization, 'Bearer staff-jwt');
    assert.equal(captured[0].init.headers.cookie, undefined);
  }

  {
    // PORT fallback keeps the server-to-server call on loopback.
    delete process.env.RESIDENCY_CHECK_RESIDENT_SERVICES_URL;
    process.env.PORT = '3456';
    const captured: Captured[] = [];
    const adapter = new HttpResidentPreviewAdapter({ fetchImpl: fakeFetch(200, previewBody, captured) });
    await adapter.previewPass(request());
    assert.equal(captured[0].url, 'http://127.0.0.1:3456' + PREVIEW_PATH);
    delete process.env.PORT;

    const capturedDefault: Captured[] = [];
    const adapterDefault = new HttpResidentPreviewAdapter({
      fetchImpl: fakeFetch(200, previewBody, capturedDefault)
    });
    await adapterDefault.previewPass(request());
    assert.equal(capturedDefault[0].url, 'http://127.0.0.1:3000' + PREVIEW_PATH);
    delete process.env.RESIDENCY_CHECK_RESIDENT_SERVICES_URL;
  }

  /* -------------------- refusal mapping without PII -------------------- */
  for (const [status, expectedFailure, expectedCode] of [
    [401, 'UNAUTHENTICATED', 'RESIDENCY_AUTH_REQUIRED'],
    [403, 'REJECTED', 'RESIDENCY_PASS_NOT_VERIFIED'],
    [404, 'REJECTED', 'RESIDENCY_PASS_NOT_VERIFIED'],
    [409, 'REJECTED', 'RESIDENCY_PASS_NOT_VERIFIED'],
    [422, 'REJECTED', 'RESIDENCY_PASS_NOT_VERIFIED'],
    [500, 'UNAVAILABLE', 'RESIDENCY_PASS_PREVIEW_UNAVAILABLE'],
    [503, 'UNAVAILABLE', 'RESIDENCY_PASS_PREVIEW_UNAVAILABLE']
  ] as const) {
    const adapter = new HttpResidentPreviewAdapter({
      fetchImpl: fakeFetch(status, {
        code: 'RESIDENT_PASS_EXPIRED',
        message: 'upstream detail ' + VALID_PASS,
        fullName: 'Анна Резидентова'
      })
    });
    const error = await expectPreviewError(() => adapter.previewPass(request()));
    assert.equal(error.failure, expectedFailure);
    assert.equal(error.code, expectedCode);
    assert.equal(error.message, 'Resident pass preview failed');
  }

  {
    // Malformed 200 payloads are rejected instead of partially trusted.
    for (const body of [
      '',
      'not-json',
      {},
      { passId: 'p', stationId: 'Piter' },
      { ...previewBody, resident: { ...previewBody.resident, confirmed: false } },
      { ...previewBody, resident: { ...previewBody.resident, subscriptionInstanceId: '' } },
      { ...previewBody, resident: { ...previewBody.resident, subscriptionInstanceId: 42 } },
      { ...previewBody, passId: '' },
      { ...previewBody, stationId: '' },
      ['array']
    ]) {
      const adapter = new HttpResidentPreviewAdapter({ fetchImpl: fakeFetch(200, body) });
      const error = await expectPreviewError(() => adapter.previewPass(request()));
      assert.equal(error.failure, 'UNAVAILABLE');
      assert.equal(error.code, 'RESIDENCY_PASS_PREVIEW_INVALID');
      assert.doesNotMatch(error.message, new RegExp(VALID_PASS));
    }
  }

  {
    // Network failure and timeout are unavailable, not a pass verdict.
    const networkFailure = new HttpResidentPreviewAdapter({
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED ' + VALID_PASS);
      }
    });
    const networkError = await expectPreviewError(() => networkFailure.previewPass(request()));
    assert.equal(networkError.failure, 'UNAVAILABLE');
    assert.equal(networkError.code, 'RESIDENCY_PASS_PREVIEW_UNAVAILABLE');
    assert.doesNotMatch(networkError.message, /ECONNREFUSED|rsp1_/);

    const hanging: ResidentPreviewFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        if (init.signal) {
          init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }
      });
    const timeoutAdapter = new HttpResidentPreviewAdapter({ fetchImpl: hanging, timeoutMs: 10 });
    const timeoutError = await expectPreviewError(() => timeoutAdapter.previewPass(request()));
    assert.equal(timeoutError.failure, 'UNAVAILABLE');
    assert.equal(timeoutError.code, 'RESIDENCY_PASS_PREVIEW_UNAVAILABLE');

    // body read failure
    const brokenBody = new HttpResidentPreviewAdapter({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw new Error('stream failed');
        }
      })
    });
    const bodyError = await expectPreviewError(() => brokenBody.previewPass(request()));
    assert.equal(bodyError.failure, 'UNAVAILABLE');
  }

  {
    // Invalid configured URL fails closed before any request is attempted.
    process.env.RESIDENCY_CHECK_RESIDENT_SERVICES_URL = 'https://user:pass@api.padlhub.su';
    let called = 0;
    const adapter = new HttpResidentPreviewAdapter({
      fetchImpl: async () => {
        called += 1;
        return { ok: true, status: 200, text: async () => JSON.stringify(previewBody) };
      }
    });
    const error = await expectPreviewError(() => adapter.previewPass(request()));
    assert.equal(error.code, 'RESIDENCY_PASS_PREVIEW_URL_INVALID');
    assert.equal(called, 0);
    delete process.env.RESIDENCY_CHECK_RESIDENT_SERVICES_URL;
  }

  if (previousUrl !== undefined) {
    process.env.RESIDENCY_CHECK_RESIDENT_SERVICES_URL = previousUrl;
  }
  if (previousPort !== undefined) process.env.PORT = previousPort;

  console.log(
    'Resident preview HTTP adapter: base URL policy, staff-session forwarding, body-only token, ' +
      'refusal/network/malformed mappings without PII tests passed'
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
