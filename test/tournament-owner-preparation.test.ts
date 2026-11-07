import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { TournamentsOwnerPreparationController } from '../src/tournaments/tournaments-owner-preparation.controller';
import { PrepareTournamentOwnerDto } from '../src/tournaments/dto/prepare-tournament-owner.dto';
import { SKIP_ADMIN_MUTATION_AUDIT_KEY } from '../src/common/observability/admin-audit.decorator';

type Raw = Record<string, unknown>;
const now = Date.parse('2026-10-31T10:00:00.000Z');
const originalNow = Date.now;
Date.now = () => now;
after(() => { Date.now = originalNow; });
const date = '2026-11-01';
const stamp = new Date(now - 10_000).toISOString();
function publicId(id: string): string {
  const b = createHash('sha256').update('phub-public-tournament-v1:' + id).digest().subarray(0, 16);
  b[6] = (b[6]! & 15) | 64; b[8] = (b[8]! & 63) | 128;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function source(id = 'source-record-1', exerciseId = 'exercise-1'): Raw {
  return { id, exerciseId, source: 'VIVA', name: 'Synthetic tournament', status: 'REGISTRATION',
    startsAt: date + 'T15:00:00.000Z', endsAt: date + 'T17:00:00.000Z',
    updatedAt: stamp, maxPlayers: 8, participantsCount: 2, isPublic: true };
}
function custom(id = 'custom-1', linked = true): Raw {
  return { id, name: 'Synthetic custom', status: 'REGISTRATION', startsAt: date + 'T15:00:00.000Z',
    endsAt: date + 'T17:00:00.000Z', updatedAt: stamp, maxPlayers: 8, isPublic: true,
    ownerPreparationMappingTypes: { details: linked ? 'object' : 'missing', booking: linked ? 'object' : 'missing',
      bookingViva: 'missing', joinFlow: 'missing', joinFlowViva: 'missing' },
    accessLevels: ['D'], gender: 'MIXED', ...(linked ? { sourceTournamentId: 'source-record-1',
      exerciseId: 'exercise-1', details: { booking: { vivaExerciseId: 'exercise-1' } } } : {}) };
}
function setup() {
  const state = {
    snapshot: { key: 'default', generatedAt: stamp, lastSuccessfulAt: stamp,
      windowFrom: '2026-10-25', windowTo: '2026-11-10', dateLastSuccessfulAt: { [date]: stamp },
      tournaments: [source()], tournamentsCount: 1 } as Raw,
    customs: [] as Raw[], interval: 60_000, sourceMissing: false, failRead: false,
    authError: null as Error | null, reads: 0, authCalls: [] as unknown[][]
  };
  const service = Object.create(TournamentsService.prototype) as TournamentsService;
  Object.assign(service, {
    lkIdentityService: { verify: async (...args: unknown[]) => {
      state.authCalls.push(args);
      if (state.authError) throw state.authError;
      assert.deepEqual(args, ['Bearer synthetic-actor', 'synthetic-integration']);
      return { actor: { tenantKey: 'iSkq6G', clientId: 'private-client', phoneNorm: 'private-phone', name: 'private-name' } };
    } },
    vivaTournamentSnapshotService: { readOwnerPreparationSnapshot: async () => {
      state.reads += 1;
      return state.sourceMissing ? null : { document: state.snapshot, freshnessIntervalMs: state.interval };
    } },
    tournamentsPersistence: { readOwnerPreparationCustomRecords: async () => {
      state.reads += 1;
      if (state.failRead) throw new Error('private database details');
      return state.customs;
    } }
  });
  const controller = new TournamentsOwnerPreparationController(service);
  const run = (id = 'source-record-1', dto?: unknown) => controller.prepare(
    'Bearer synthetic-actor', 'synthetic-integration', (dto ?? { tournamentId: publicId(id), date }) as PrepareTournamentOwnerDto);
  return { state, service, controller, run };
}

test('source record ID, not exercise ID, drives the current public UUID and exact nonbinding result', async () => {
  const x = setup();
  const r = await x.run('source-record-1', { tournamentId: 'b113555e-3f82-413e-b781-8ce9e2f024db', date });
  assert.equal(r.status, 'RESOLVED'); assert.equal(r.owner, 'VIVA_SOURCE');
  assert.deepEqual(Object.keys(r).sort(), ['binding', 'date', 'nonBinding', 'observedAt', 'owner', 'reason', 'schemaVersion', 'status', 'tournamentId']);
  assert.equal(r.binding?.feedId, 'source-record-1'); assert.equal(r.binding?.exerciseId, 'exercise-1');
  assert.equal(r.binding?.customTournamentId, null); assert.equal(r.nonBinding, true);
  assert.equal((await x.run('exercise-1')).status, 'UNKNOWN');
  const json = JSON.stringify(r);
  for (const value of ['private-client', 'private-phone', 'private-name', 'synthetic-integration', 'synthetic-actor']) assert.ok(!json.includes(value));
  assert.ok(!json.includes('eligible')); assert.ok(!json.includes('expiresAt'));
});

test('linked CUP keeps the source feed ID; standalone custom uses its own feed ID', async () => {
  const x = setup(); x.state.customs = [custom()];
  const linked = await x.run(); assert.equal(linked.owner, 'CUP_CUSTOM'); assert.equal(linked.binding?.customTournamentId, 'custom-1');
  assert.equal((await x.run('custom-1')).reason, 'TARGET_NOT_FOUND');
  x.state.customs = [custom('standalone', false)];
  const standalone = await x.run('standalone'); assert.equal(standalone.owner, 'CUP_CUSTOM'); assert.equal(standalone.binding?.exerciseId, null);
});

test('source disappearance never resolves the custom fallback as a booking target', async () => {
  const x = setup(); x.state.customs = [custom()]; x.state.snapshot.tournaments = []; x.state.snapshot.tournamentsCount = 0;
  assert.equal((await x.run('custom-1')).reason, 'SOURCE_UNAVAILABLE');
});

test('complete authoritative custom lookup failure is not a negative ownership result', async () => {
  const x = setup(); x.state.failRead = true;
  const r = await x.run(); assert.equal(r.reason, 'READ_UNAVAILABLE'); assert.equal(r.owner, null); assert.equal(r.binding, null);
  assert.ok(!JSON.stringify(r).includes('private database'));
  x.state.failRead = false; x.state.sourceMissing = true;
  assert.equal((await x.run()).reason, 'SNAPSHOT_UNAVAILABLE');
});

test('integration auth precedes every read and cannot be replaced by body tenant or identity claims', async () => {
  for (const error of [new UnauthorizedException(), new ForbiddenException()]) {
    const x = setup(); x.state.authError = error;
    await assert.rejects(x.run(), (caught) => caught === error); assert.equal(x.state.reads, 0);
  }
  for (const input of [null, [], { tournamentId: publicId('source-record-1'), date, tenantKey: 'foreign' },
    { tournamentId: publicId('source-record-1'), date, owner: 'VIVA_SOURCE' },
    { tournamentId: publicId('source-record-1'), date: '2026-02-30' },
    { tournamentId: publicId('source-record-1') + '\n', date },
    { tournamentId: 'exercise-1', date }]) {
    const x = setup();
    await assert.rejects(x.controller.prepare('Bearer synthetic-actor', 'synthetic-integration', input as PrepareTournamentOwnerDto), BadRequestException);
    assert.equal(x.state.reads, 0);
  }
});

test('strict DTO and controller metadata preserve private auth/no-store/no mutation audit', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const metadata = { type: 'body' as const, metatype: PrepareTournamentOwnerDto };
  await pipe.transform({ tournamentId: publicId('source-record-1'), date }, metadata);
  await assert.rejects(pipe.transform({ tournamentId: publicId('source-record-1'), date, exerciseId: 'claimed' }, metadata));
  assert.equal(Reflect.getMetadata(PATH_METADATA, TournamentsOwnerPreparationController), 'internal/tournaments/owner-preparations');
  const handler = TournamentsOwnerPreparationController.prototype.prepare;
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), 1);
  assert.equal(Reflect.getMetadata(SKIP_ADMIN_MUTATION_AUDIT_KEY, handler), true);
  assert.deepEqual(Reflect.getMetadata(HEADERS_METADATA, handler), [
    { name: 'Referrer-Policy', value: 'no-referrer' }, { name: 'Cache-Control', value: 'no-store' }
  ]);
});

test('global fresh timestamp and partial multiwidget snapshot cannot replace explicit dated success', async () => {
  const x = setup(); x.state.snapshot.dateLastSuccessfulAt = {};
  assert.equal((await x.run()).reason, 'DATA_INVALID');
  x.state.snapshot.dateLastSuccessfulAt = { [date]: stamp };
  assert.equal((await x.run()).status, 'RESOLVED');
});

test('old/future/malformed observation, missing interval and uncovered date fail closed', async () => {
  for (const value of [new Date(now + 1).toISOString(), '2026-02-30T10:00:00.000Z', 'yesterday', null]) {
    const x = setup(); x.state.snapshot.dateLastSuccessfulAt = { [date]: value };
    assert.equal((await x.run()).reason, 'DATA_INVALID');
  }
  const old = setup(); old.state.snapshot.dateLastSuccessfulAt = { [date]: new Date(now - 60_001).toISOString() };
  assert.equal((await old.run()).reason, 'SNAPSHOT_STALE');
  for (const interval of [undefined as unknown as number, NaN, Infinity, 0, 999, 300_001]) {
    const x = setup(); x.state.interval = interval; assert.equal((await x.run()).reason, 'DATA_INVALID');
  }
  const uncovered = setup(); uncovered.state.snapshot.windowTo = '2026-10-31'; assert.equal((await uncovered.run()).reason, 'DATA_INVALID');
});

test('duplicate and conflicting cross-field mappings never select the first custom record', async () => {
  const cases: Raw[][] = [
    [custom(), custom('custom-2')],
    [custom(), { ...custom('custom-2', false), details: { joinFlow: { viva: { exerciseId: 'exercise-1' } } } }],
    [{ ...custom(), exerciseId: 'other-exercise' }],
    [{ ...custom(), details: { booking: { vivaExerciseId: 'exercise-1', exerciseId: 'other' } } }],
    [custom(), { ...custom(), sourceTournamentId: 'unrelated' }],
    [{ ...custom('exercise-1', false) }]
  ];
  for (const records of cases) { const x = setup(); x.state.customs = records; assert.equal((await x.run()).reason, 'MAPPING_AMBIGUOUS'); }
  const x = setup(); x.state.snapshot.tournaments = [source(), source('source-2')]; x.state.snapshot.tournamentsCount = 2;
  assert.equal((await x.run()).reason, 'MAPPING_AMBIGUOUS');
});

test('malformed/archived/missing-gender custom is never silently dropped to Viva ownership', async () => {
  for (const row of [{ ...custom(), archived: true }, { ...custom(), gender: undefined },
    { ...custom(), id: '' }, { ...custom(), updatedAt: new Date(now + 1).toISOString() },
    { ...custom(), details: { booking: false } }]) {
    const x = setup(); x.state.customs = [row]; assert.equal((await x.run()).reason, 'DATA_INVALID');
  }
});

test('projected-away corrupt mapping parents remain invalid through computed raw-type evidence', async () => {
  for (const key of ['details', 'booking', 'bookingViva', 'joinFlow', 'joinFlowViva']) {
    for (const type of ['bool', 'array', 'string', 'int']) {
      const row = custom(); delete row.details; // Actual dotted projection may omit the scalar parent.
      row.ownerPreparationMappingTypes = { ...(row.ownerPreparationMappingTypes as Raw), [key]: type };
      const x = setup(); x.state.customs = [row]; assert.equal((await x.run()).reason, 'DATA_INVALID');
    }
  }
  for (const types of [undefined, {}, { details: 'object' }, { ...(custom().ownerPreparationMappingTypes as Raw), extra: 'missing' }]) {
    const x = setup(); x.state.customs = [{ ...custom(), ownerPreparationMappingTypes: types }];
    assert.equal((await x.run()).reason, 'DATA_INVALID');
  }
});

test('500 complete records can resolve;501 custom or dated source records are UNKNOWN', async () => {
  const x = setup(); x.state.customs = Array.from({ length: 500 }, (_, i) => custom('unrelated-' + i, false));
  assert.equal((await x.run()).owner, 'VIVA_SOURCE');
  x.state.customs.push(custom('unrelated-500', false)); assert.equal((await x.run()).reason, 'READ_LIMIT_EXCEEDED');
  x.state.customs = []; x.state.snapshot.tournaments = Array.from({ length: 501 }, (_, i) => source('s-' + i, 'e-' + i)); x.state.snapshot.tournamentsCount = 501;
  assert.equal((await x.run('s-0')).reason, 'READ_LIMIT_EXCEEDED');
});

test('digest is deterministic across object key order, changes with matching version/rules, and grants no gender eligibility', async () => {
  const x = setup(); x.state.customs = [custom()]; const first = await x.run();
  x.state.customs = [Object.fromEntries(Object.entries(custom()).reverse())];
  assert.equal((await x.run()).binding?.mappingSha256, first.binding?.mappingSha256);
  x.state.customs[0]!.updatedAt = new Date(now - 1_000).toISOString();
  assert.notEqual((await x.run()).binding?.mappingSha256, first.binding?.mappingSha256);
  x.state.customs = [{ ...custom(), gender: 'FEMALE', accessLevels: ['A'] }];
  const changed = await x.run(); assert.equal(changed.owner, 'CUP_CUSTOM');
  assert.notEqual(changed.binding?.mappingSha256, first.binding?.mappingSha256);
  assert.ok(!JSON.stringify(changed).includes('FEMALE'));
});
