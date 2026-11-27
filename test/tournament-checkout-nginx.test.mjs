import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildTournamentCheckoutNginx } from '../scripts/build-tournament-checkout-nginx.mjs';

const headers = 'Origin, Content-Type, Accept, Authorization, Range, X-PadlHub-Auth-Source, X-PadlHub-Tenant-Key';
const apiLocation = `location ^~ /api/ {
     if ($request_method = OPTIONS) { return 204; }
    proxy_pass http://127.0.0.1:3000;
    add_header Access-Control-Allow-Origin "https://padlhub.ru" always;
    add_header Access-Control-Allow-Headers "${headers}" always;
}`;
const publicLocation = `location ^~ /api/tournaments/public/ {
    add_header Access-Control-Allow-Headers "${headers}" always;
}`;
const source = `server {\n${publicLocation}\n\n${apiLocation}\n}\n`;
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('allows Idempotency-Key only on the tournament checkout path before OPTIONS returns', () => {
  const candidate = buildTournamentCheckoutNginx(Buffer.from(source), sha256(source));
  const routePattern = candidate.match(/if \(\$request_uri ~ "([^"]+)"\)/)?.[1];
  assert.ok(routePattern);
  const route = new RegExp(routePattern);
  const example = '/api/tournaments/5a2303ec-8fc3-4b0c-afcc-fe3685b48b5e';
  assert.equal(route.test(`${example}/checkout`), true);
  assert.equal(route.test(`${example}/checkout/`), true);
  assert.equal(route.test(`${example}/checkout?source=lk`), true);
  for (const path of [example, `${example}/checkout/status`, `${example}/%63heckout`,
    `${example}//checkout`, '/api/tournaments/public/checkout', '/api/games/checkout']) {
    assert.equal(route.test(path), false, path);
  }
  assert.equal(candidate.split('Idempotency-Key').length, 2);
  assert.ok(candidate.indexOf('Idempotency-Key') < candidate.indexOf('$request_method = OPTIONS'));
  assert.ok(candidate.includes(publicLocation));
  assert.ok(candidate.includes('add_header Access-Control-Allow-Origin "https://padlhub.ru" always;'));
  assert.ok(candidate.includes('add_header Access-Control-Allow-Headers $phab_api_cors_headers always;'));
  assert.ok(candidate.includes('proxy_pass http://127.0.0.1:3000;'));
});

test('rejects config drift and ambiguous locations', () => {
  assert.throws(() => buildTournamentCheckoutNginx(Buffer.from(source), '0'.repeat(64)), /SHA-256 mismatch/);
  for (const unexpected of [source.replace('return 204', 'return 200'),
    source.replaceAll('https://padlhub.ru', '*'), source + apiLocation]) {
    assert.throws(() => buildTournamentCheckoutNginx(Buffer.from(unexpected), sha256(unexpected)), /audited preimage|exactly one/);
  }
});
