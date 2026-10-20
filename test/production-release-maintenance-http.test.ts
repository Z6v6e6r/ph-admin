import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import express = require('express');
import { releaseMaintenanceFence } from '../src/common/release-maintenance';

async function main(): Promise<void> {
  const app = express();
  let handlerCalls = 0;
  app.use(releaseMaintenanceFence());
  app.all('*', (_request, response) => {
    handlerCalls += 1;
    response.json({ ok: true });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const request = (method: string, path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: address.port, method, path }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });
  try {
    const paymentReturn = await request('GET', '/api/tournaments/public/cup/join?paymentsuccess=true');
    assert.equal(paymentReturn.status, 503, 'payment-success GET must be rejected before handlers');
    assert.equal(handlerCalls, 0, 'the payment-return handler must never execute');
    let blockedRequests = 1;
    const allowed = [
      '/api/health', '/api/auth/me', '/api/ui/admin',
      '/api/client-script/admin-panel.js',
      '/api/client-script/gift-certificates-admin.js',
      '/api/client-script/referral-links-admin.js'
    ];
    for (const path of allowed) {
      for (const method of ['GET', 'HEAD']) {
        const result = await request(method, path + '?release_smoke=synthetic-nonce');
        assert.equal(result.status, 200, `${method} ${path} remains available`);
        assert.equal(result.headers['x-phab-release-mode'], 'maintenance');
        assert.match(String(result.headers['x-correlation-id']), /^[a-f0-9-]{36}$/);
      }
    }
    const allowedCalls = handlerCalls;
    const blocked = [
      ['GET', '/api/tournaments/public/cup/join?paymentsuccess=true'],
      ['GET', '/api/support/outbox/pull'],
      ['GET', '/api/integrations/telegram/outbox/pull'],
      ['GET', '/api/messenger/threads/thread/messages'],
      ['POST', '/api/support/dialogs/events'],
      ['POST', '/api/integrations/telegram/webhook'],
      ['POST', '/api/auth/login'],
      ['POST', '/api/auth/logout'],
      ['POST', '/api/tournaments/public/cup/join'],
      ['DELETE', '/api/tournaments/cup/register'],
      ['OPTIONS', '/api/auth/me'],
      ['POST', '/api/health'],
      ['GET', '/api/health/'],
      ['GET', '//api/health'],
      ['GET', '/api/x/../health'],
      ['GET', '/%61pi/health'],
      ['GET', '/api/health%2f..%2ftournaments'],
      ['GET', '/api/client-script/../tournaments/public/cup/join'],
      ['GET', 'http://example.invalid/api/health'],
      ['GET', '/api/client-script/community-feed.js']
    ];
    for (const [method, path] of blocked) {
      const result = await request(method, path);
      assert.equal(result.status, 503, `${method} ${path} must not reach a handler`);
      assert.equal(JSON.parse(result.body).code, 'RELEASE_MAINTENANCE');
      assert.equal(result.headers['cache-control'], 'no-store');
      blockedRequests += 1;
    }
    assert.equal(handlerCalls, allowedCalls, 'blocked requests never execute downstream handlers');
    console.log(`Maintenance HTTP fence verified: ${allowedCalls} allowed requests, ${blockedRequests} rejected requests`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
