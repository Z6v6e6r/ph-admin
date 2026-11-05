import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import {
  generateResidentPassToken,
  hashResidentIdempotencyKey,
  hashResidentPassToken,
  isResidentPassToken,
  isoWeekKey,
  residentPeriodKey,
  residentRequestHash,
  residentStationScopeKey,
  safeStringEqual
} from '../src/resident-services/resident-service-crypto';
import { RESIDENT_SERVICE_KINDS } from '../src/resident-services/resident-services.types';

function main(): void {
  const token = generateResidentPassToken();
  assert.match(token, /^rsp1_[A-Za-z0-9_-]{43}$/);
  assert.ok(isResidentPassToken(token));
  assert.equal(isResidentPassToken('rsp1_short'), false);
  assert.equal(isResidentPassToken('random-token-value'), false);
  assert.notEqual(generateResidentPassToken(), token);

  const pepper = 'token-pepper-'.repeat(4);
  const hash = hashResidentPassToken(pepper, token);
  assert.equal(hash, hashResidentPassToken(pepper, token));
  assert.notEqual(hash, hashResidentPassToken('other-pepper-'.repeat(4), token));
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash.includes(token), false);
  assert.equal(safeStringEqual(hash, hash), true);
  assert.equal(safeStringEqual(hash, hash.slice(0, -1) + '0'), false);

  const idempotency = hashResidentIdempotencyKey({
    pepper,
    tenantId: 'iSkq6G',
    actorId: 'admin:1',
    key: 'idem-0001'
  });
  assert.equal(idempotency, hashResidentIdempotencyKey({
    pepper,
    tenantId: 'iSkq6G',
    actorId: 'admin:1',
    key: 'idem-0001'
  }));
  assert.notEqual(idempotency, hashResidentIdempotencyKey({
    pepper,
    tenantId: 'iSkq6G',
    actorId: 'admin:2',
    key: 'idem-0001'
  }));

  assert.equal(
    residentRequestHash(['a', 'b']),
    residentRequestHash(['a', 'b'])
  );
  assert.notEqual(residentRequestHash(['a', 'b']), residentRequestHash(['a', 'c']));

  assert.equal(isoWeekKey(2026, 1, 1), '2026-W01');
  assert.equal(isoWeekKey(2026, 11, 5), '2026-W45');
  assert.equal(isoWeekKey(2027, 1, 1), '2026-W53');

  const morning = new Date('2026-11-05T08:00:00.000Z');
  assert.equal(residentPeriodKey('DAY', morning), '2026-11-05');
  assert.equal(residentPeriodKey('WEEK', morning), '2026-W45');
  assert.equal(residentPeriodKey('MONTH', morning), '2026-11');
  assert.equal(residentPeriodKey('SUBSCRIPTION', morning, 'subscription_instance:piter-1'), 'subscription_instance:piter-1');
  assert.throws(() => residentPeriodKey('SUBSCRIPTION', morning));

  const afterMoscowMidnight = new Date('2026-11-05T21:30:00.000Z');
  assert.equal(residentPeriodKey('DAY', afterMoscowMidnight), '2026-11-06');
  assert.equal(residentPeriodKey('WEEK', afterMoscowMidnight), '2026-W45');
  assert.equal(residentPeriodKey('MONTH', afterMoscowMidnight), '2026-11');

  const newYearMoscow = new Date('2025-12-31T22:30:00.000Z');
  assert.equal(residentPeriodKey('DAY', newYearMoscow), '2026-01-01');
  assert.equal(residentPeriodKey('WEEK', newYearMoscow), '2026-W01');
  assert.equal(residentPeriodKey('MONTH', newYearMoscow), '2026-01');

  assert.equal(residentStationScopeKey([]), 'ALL');
  assert.equal(
    residentStationScopeKey(['station:b', 'station:a', 'station:b']),
    'STATIONS:station:a,station:b'
  );
  assert.deepEqual([...RESIDENT_SERVICE_KINDS], ['TOWEL', 'RACKET']);

  console.log('resident-services-token: ok');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}