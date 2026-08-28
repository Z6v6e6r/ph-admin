import * as assert from 'node:assert/strict';
import { ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import * as path from 'node:path';

interface GuardSummary {
  type: 'guard-summary';
  signal: string;
  mongoConnectAttempts: number;
  externalFetchAttempts: number;
  externalSocketAttempts: number;
  externalListenAttempts: number;
}

interface ExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

function isolatedChildEnv(port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    NODE_ENV: 'test',
    TZ: 'Europe/Moscow',
    HOST: '127.0.0.1',
    PORT: String(port),
    REQUEST_BODY_LIMIT: '1mb',
    TRUST_PROXY: 'false',
    ADMIN_AUTH_ENABLED: 'false',
    ADMIN_AUTH_REQUIRE_STAFF_TOKEN: 'false',
    HTTP_METRICS_LOG_INTERVAL_MS: '0',
    PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED: 'false',
    TOURNAMENTS_VIVA_STATUS_SYNC_INTERVAL_MS: '0',
    TOURNAMENTS_VIVA_STATUS_SYNC_RUN_ON_STARTUP: 'false',
    VIVA_TOURNAMENT_SNAPSHOT_ENABLED: 'false',
    VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL: 'false',
    VIVA_TOURNAMENT_SNAPSHOT_PUBLIC_REVALIDATION_ENABLED: 'false',
    VIVA_REFERENCE_CACHE_ENABLED: 'false',
    WEB_PUSH_ENABLED: 'false',
    TELEGRAM_DELIVERY_MODE: 'outbox',
    SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED: 'false',
    SUBSCRIPTIONS_RUNTIME_V1_QUOTE_ENABLED: 'false',
    SUBSCRIPTIONS_RUNTIME_V1_MODE: 'OFF'
  };
}

function appendBounded(current: string, chunk: Buffer | string): string {
  return `${current}${String(chunk)}`.slice(-12_000);
}

function diagnostic(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join('\n').slice(-16_000);
}

async function waitForHealth(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`main bootstrap exited before health check (${child.exitCode ?? child.signalCode})`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(1000)
      });
      const body = await response.json() as Record<string, unknown>;
      assert.equal(response.status, 200);
      assert.equal(body.status, 'ok');
      return;
    } catch (error) {
      lastError = String(error);
      await delay(100);
    }
  }
  throw new Error(`main bootstrap health timeout: ${lastError}`);
}

async function assertPortReleased(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function waitForExit(
  exitPromise: Promise<ExitResult>,
  timeoutMs: number
): Promise<ExitResult | undefined> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(undefined), timeoutMs);
    exitPromise.then((result) => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
}

async function run(): Promise<void> {
  const port = await reserveLoopbackPort();
  const root = process.cwd();
  const guardPath = path.join(root, 'test/subscriptions-runtime-v1-main-external-guard.cjs');
  const mainPath = path.join(root, 'dist/main.js');
  const child = spawn(process.execPath, ['--require', guardPath, mainPath], {
    cwd: root,
    env: isolatedChildEnv(port),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  let stdout = '';
  let stderr = '';
  let summary: GuardSummary | undefined;
  child.stdout?.on('data', (chunk) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderr = appendBounded(stderr, chunk);
  });
  child.on('message', (message: unknown) => {
    if (message && typeof message === 'object' && (message as any).type === 'guard-summary') {
      summary = message as GuardSummary;
    }
  });
  const exitPromise = new Promise<ExitResult>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ code: null, signal: null, error }));
  });

  let exitResult: ExitResult | undefined;
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);

    const response = await fetch(`${baseUrl}/api/internal/subscription-runtime/quote`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer isolated-main-bootstrap-user',
        'x-subscriptions-integration-token': 'isolated-main-bootstrap-token-000000',
        'x-correlation-id': 'correlation:main-bootstrap',
        'idempotency-key': 'idempotency:main-bootstrap',
        'x-subscription-runtime-contract-version': '1'
      },
      body: JSON.stringify({
        action: 'JOIN_GAME',
        target: { kind: 'GAME', id: 'game:main-bootstrap', expectedRevision: 1 },
        preferredSubscriptionInstanceId: 'subscription_instance:main-bootstrap',
        paymentIntent: 'USE_SUBSCRIPTION'
      })
    });
    const body = await response.json() as any;
    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'UPSTREAM_UNAVAILABLE');
    assert.equal(
      body.error.details.domainCode,
      'SUBSCRIPTIONS_RUNTIME_V1_QUOTE_DISABLED'
    );
    assert.equal(response.headers.get('x-correlation-id'), 'correlation:main-bootstrap');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
    }
    exitResult = await waitForExit(exitPromise, 5000);
    if (!exitResult) {
      child.kill('SIGKILL');
      exitResult = await exitPromise;
    }
  }

  assert.deepEqual(exitResult, { code: 0, signal: null }, diagnostic(stdout, stderr));
  assert.ok(summary, `missing external guard summary\n${diagnostic(stdout, stderr)}`);
  assert.equal(summary.signal, 'SIGTERM');
  assert.equal(summary.mongoConnectAttempts, 0);
  assert.equal(summary.externalFetchAttempts, 0);
  assert.equal(summary.externalSocketAttempts, 0);
  assert.equal(summary.externalListenAttempts, 0);
  await assertPortReleased(port);
  console.log('subscriptions runtime v1 quote main bootstrap smoke: OK');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
