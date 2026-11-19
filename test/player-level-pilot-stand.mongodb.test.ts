import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { Role } from '../src/common/rbac/role.enum';
import { validate } from 'class-validator';
import { MongoClient } from 'mongodb';
import { Workbook } from 'exceljs';
import { exportPlayerRatingAudit } from '../src/player-ratings/player-rating-audit-export';
import { ChangePlayerRatingDto } from '../src/player-ratings/dto/change-player-rating.dto';
import { readPlayerLevelPilot } from '../src/player-ratings/player-level-projection-pilot';
import { PlayerLevelProjectionService } from '../src/player-ratings/player-level-projection.service';
import { PlayerRatingRepository } from '../src/player-ratings/player-ratings.repository';
import { PlayerRatingsService } from '../src/player-ratings/player-ratings.service';
import { PadlHubPlayerLevelProjectionOutboxDocument, PlayerRatingGrade, PlayerRatingStateDocument } from '../src/player-ratings/player-ratings.types';

const fixtureOrigin = 'http://127.0.0.1:18078';
const fixtureToken = 'synthetic-approved-pilot-projection-token';
const mongoUri = 'mongodb://127.0.0.1:27079/?replicaSet=pilot374&directConnection=true&retryWrites=true&w=majority';
const oldTime = '2026-11-18T00:00:00.000Z';
const actor = { id: 'synthetic-rating-operator', authSource: 'token', permissions: ['player-ratings:write'], stationIds: [], roles: [Role.MANAGER], connectorRoutes: [] } as Parameters<PlayerRatingsService['change']>[2];
const past = new Date(0).toISOString();

function canonical(clientId: string, ratingNumeric: number, rating: PlayerRatingGrade): PlayerRatingStateDocument {
  return {
    playerKey: 'client:' + clientId, clientId, ratingNumeric, rating, name: 'Synthetic player',
    ownership: 'CUP_CANONICAL', schemaVersion: 1, createdAt: oldTime, updatedAt: oldTime,
    lastEventAt: oldTime, lastEventId: 'rating_evt:synthetic-old:' + clientId,
    lastSource: 'SYNTHETIC', lastEventType: 'RATING_INITIAL_IMPORTED',
    lastChangedBy: { id: 'synthetic', name: 'Synthetic', type: 'SYSTEM' }
  };
}

function packet(state: PlayerRatingStateDocument): ChangePlayerRatingDto {
  return {
    ratingNumeric: state.ratingNumeric, expectedLastEventId: state.lastEventId,
    expectedPreviousGrade: state.rating, expectedClientId: state.clientId,
    idempotencyKey: 'synthetic-alignment:' + state.playerKey, reason: 'Synthetic alignment preserving the number'
  };
}

function persistedOutbox(state: PlayerRatingStateDocument, status: PadlHubPlayerLevelProjectionOutboxDocument['status']) {
  const revision = state.padlHubProjectionRevision ?? 0;
  return {
    playerKey: state.playerKey, status, desiredRevision: revision, deliveredRevision: -1,
    attempts: 2, maxAttempts: 20, nextAttemptAt: past, leaseUntil: past,
    createdAt: oldTime, updatedAt: oldTime,
    desired: {
      sourceRevision: revision, sourceEventId: state.lastEventId, occurredAt: state.lastEventAt,
      player: { externalClientId: state.clientId }, level: { code: state.rating, numericValue: state.ratingNumeric },
      schemaVersion: 1, sportCode: 'PADEL', source: { eventType: state.lastEventType, formulaVersion: 'padel-rating-grade-v1' }
    }
  };
}

async function rehearsal(): Promise<any> {
  const response = await fetch(fixtureOrigin + '/rehearsal', { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  return response.json();
}

function pg(sql: string): string {
  return execFileSync('docker', ['exec', '-i', 'phub-rating-pilot-20261119-pg',
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-U', 'postgres', '-d', 'phub_cup_level_probe'],
  { input: sql, encoding: 'utf8', timeout: 7000 }).trim();
}

async function main() {
  assert.equal(process.env.PHUB_SYNTHETIC_RATING_PILOT, 'ONLY_LOCAL_DISPOSABLE_374');
  assert.equal((await rehearsal()).projectionStatus, 'PENDING');
  assert.equal((await rehearsal()).events.length, 0);
  const dbName = 'phub_rating_pilot_374_' + process.pid;
  process.env.PLAYER_RATINGS_MONGODB_DB = dbName;
  process.env.PLAYER_RATINGS_MONGODB_URI = mongoUri;
  process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED = 'true';
  process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_URL = fixtureOrigin;
  process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_TENANT_KEY = 'local-padel';
  process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_TOKEN = fixtureToken;
  const mapped = canonical('synthetic-shared-player', 2.12345, 'D');
  const relinked = canonical('synthetic-relinked', 3.12345, 'C');
  const staleIdentity = { ...relinked, clientId: 'synthetic-former-profile' };
  const mixedLease = canonical('synthetic-mixed-lease', 3.12345, 'C');
  const missing = Array.from({ length: 6 }, (_, index) => canonical('synthetic-missing-' + index, 3.12345, 'C'));
  const excluded = ['PENDING', 'DELIVERING', 'DEAD'].map((status, index) => ({
    row: canonical('synthetic-excluded-' + index, 4.12345, 'B'),
    status: status as PadlHubPlayerLevelProjectionOutboxDocument['status']
  }));
  process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_MODE = 'pilot';
  const pilot = [...missing, mapped, relinked, mixedLease].map(({ playerKey, clientId }) => ({ playerKey, clientId }));
  process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_PILOT_BINDINGS = JSON.stringify(pilot);
  assert.throws(() => readPlayerLevelPilot({ PADLHUB_PLAYER_LEVEL_PROJECTION_MODE: 'pilot' }));
  assert.throws(() => readPlayerLevelPilot({ PADLHUB_PLAYER_LEVEL_PROJECTION_MODE: 'pilot', PADLHUB_PLAYER_LEVEL_PROJECTION_PILOT_BINDINGS: '[]' }));
  assert.throws(() => readPlayerLevelPilot({ PADLHUB_PLAYER_LEVEL_PROJECTION_PILOT_BINDINGS: JSON.stringify(pilot) }));

  const mongo = new MongoClient(mongoUri);
  const repo = new PlayerRatingRepository();
  const worker = new PlayerLevelProjectionService(repo);
  try {
    await repo.connect();
    const db = mongo.db(dbName);
    const states = db.collection<PlayerRatingStateDocument>('player_rating_state');
    const events = db.collection('rating_events');
    const compatibility = db.collection('player_ratings');
    const outbox = db.collection('player_level_projection_outbox');
    const service = new PlayerRatingsService(repo);
    async function seed(rows: PlayerRatingStateDocument[]) {
      await states.insertMany(rows);
      await compatibility.insertMany(rows.map(row => ({ ...row })));
      await events.insertMany(rows.map(row => ({
        id: row.lastEventId, idempotencyKey: row.lastEventId, eventType: row.lastEventType,
        player: { key: row.playerKey, clientId: row.clientId },
        change: { after: row.ratingNumeric, gradeAfter: row.rating }
      })));
    }
    await seed([mapped, relinked, mixedLease, ...missing, ...excluded.map(item => item.row)]);
    const { desiredRevision: _historicalMissingRevision, ...partialOldIdentity } = persistedOutbox(staleIdentity, 'DELIVERING');
    await outbox.insertMany([
      ...missing.map(row => persistedOutbox(row, 'PENDING')),
      // A partial historical row still belongs to its original external identity.
      partialOldIdentity,
      { ...persistedOutbox(mixedLease, 'DELIVERING'), inFlight: persistedOutbox(staleIdentity, 'DELIVERING').desired },
      ...excluded.map(({ row, status }) => persistedOutbox(row, status))
    ]);
    const exclusionFilter = { playerKey: { $in: [relinked.playerKey, mixedLease.playerKey, ...excluded.map(({ row }) => row.playerKey)] } };
    const beforeExcluded = await outbox.find(exclusionFilter).sort({ playerKey: 1 }).toArray();
    await assert.rejects(service.retryPlayerLevelProjection(excluded[2].row.playerKey, actor), (e: any) => e.status === 404);
    await service.change(relinked.playerKey, {
      ratingNumeric: 3.2, expectedLastEventId: relinked.lastEventId,
      idempotencyKey: 'synthetic-relinked-numeric-change', reason: 'Synthetic normal canonical update'
    }, actor);
    assert.equal(await states.findOne({ playerKey: relinked.playerKey }).then(item => item?.ratingNumeric), 3.2);
    const outside = 'synthetic-assignment-excluded';
    await service.assign({ clientId: outside, ratingNumeric: 3.5, idempotencyKey: 'synthetic-assignment-outside',
      reason: 'Synthetic assignment outside the pilot' }, { clientId: outside }, actor);
    assert.equal((await states.findOne({ clientId: outside }))?.padlHubProjectionRevision, undefined);
    assert.equal(await outbox.countDocuments({ playerKey: 'client:' + outside }), 0);

    const dto = Object.assign(new ChangePlayerRatingDto(), packet(mapped));
    assert.deepEqual(await validate(dto), []);
    assert.ok((await validate(Object.assign(new ChangePlayerRatingDto(), dto, { expectedClientId: undefined }))).length > 0);
    await assert.rejects(service.change(mapped.playerKey, { ...dto, ratingNumeric: 2.5 }, actor), (e: any) => e.status === 409);
    await assert.rejects(service.change(mapped.playerKey, { ...dto, expectedClientId: 'synthetic-unrelated' }, actor), (e: any) => e.status === 409);
    const scopedActor = { ...actor!, permissionStationScopes: { 'player-ratings:write': ['synthetic-station'] } };
    await assert.rejects(service.change(mapped.playerKey, dto, scopedActor), (e: any) => e.status === 403);
    await assert.rejects(service.change(mapped.playerKey, dto, { ...actor!, permissions: [] }), (e: any) => e.status === 403);
    const [one, two] = await Promise.all([service.change(mapped.playerKey, dto, actor), service.change(mapped.playerKey, dto, actor)]);
    assert.equal(one.event.id, two.event.id);
    assert.equal(one.event.source.domain, 'ADMIN_MANUAL');
    assert.equal(one.event.gradeBefore, 'D');
    assert.equal(one.event.gradeAfter, 'D+');
    assert.equal(one.event.delta, 0);
    await assert.rejects(service.change(mapped.playerKey, { ...dto, expectedLastEventId: 'rating_evt:synthetic-other' }, actor), (e: any) => e.status === 409);
    assert.equal(await events.countDocuments({ 'player.key': mapped.playerKey }), 2);

    await worker.runCycle();
    const received = await rehearsal();
    assert.equal(received.projectionStatus, 'PROJECTED');
    assert.equal(received.currentLevel.code, 'D+');
    assert.equal(received.currentLevel.numericValue, mapped.ratingNumeric);
    assert.equal(received.events.length, 1);
    assert.equal(received.events[0].source_event_id, one.event.id);
    assert.equal(worker.metricsSnapshot().applied, 1);
    assert.equal(worker.metricsSnapshot().waitingForMapping, 6);
    assert.equal(worker.metricsSnapshot().pilotBindingConflicts, 2);
    assert.equal(worker.metricsSnapshot().failed, 0);
    assert.equal(worker.metricsSnapshot().circuitOpen, false);
    assert.deepEqual(await outbox.find(exclusionFilter).sort({ playerKey: 1 }).toArray(), beforeExcluded);
    const waiting = await outbox.find({ status: 'WAITING_FOR_MAPPING' }).toArray();
    assert.equal(waiting.length, 6);
    assert.ok(waiting.every(row => row.attempts === 2 && row.leaseOwner === null && row.deliveredRevision === -1));
    assert.equal(pg('select count(*) from eligibility.cup_player_level_projections;'), '1');
    assert.equal(pg('select count(*) from eligibility.cup_player_level_projection_events;'), '1');
    const waitAttemptCount = worker.metricsSnapshot().attempts;
    await worker.runCycle();
    assert.equal(worker.metricsSnapshot().attempts, waitAttemptCount, 'waiting rows back off');
    console.log('PASS 6 actual LK2 409 mapping misses, confirmed profile delivered, excluded queue unchanged');

    const recovered = missing[0];
    pg(`begin;
      insert into identity.users (id, tenant_id) select '00000000-0000-4000-a000-000000000873', id from identity.tenants where tenant_key='local-padel';
      insert into integration.external_entity_map (tenant_id, external_system, entity_type, internal_id, external_id, sync_status)
        select id, 'VIVA', 'viva_profile', '00000000-0000-4000-a000-000000000873', 'synthetic-missing-0', 'synced' from identity.tenants where tenant_key='local-padel';
      insert into profile.user_summaries (tenant_id, user_id, display_name)
        select id, '00000000-0000-4000-a000-000000000873', 'Synthetic relink' from identity.tenants where tenant_key='local-padel';
      commit;`);
    await service.retryPlayerLevelProjection(recovered.playerKey, actor);
    await worker.runCycle();
    const recoveredRow = await outbox.findOne({ playerKey: recovered.playerKey });
    assert.equal(recoveredRow?.status, 'SYNCED');
    assert.equal(recoveredRow?.desired.sourceEventId, recovered.lastEventId);
    assert.equal(recoveredRow?.deliveredRevision, 0);
    assert.equal(pg('select count(*) from eligibility.cup_player_level_projection_events;'), '2');
    console.log('PASS mapped later, same source event and revision delivered');

    await states.updateOne({ playerKey: mapped.playerKey }, { $unset: { padlHubProjectionRevision: '' } });
    await outbox.updateOne({ playerKey: mapped.playerKey }, { $set: { status: 'PENDING', nextAttemptAt: past } });
    await worker.runCycle();
    assert.equal((await states.findOne({ playerKey: mapped.playerKey }))?.padlHubProjectionRevision, 1);
    assert.equal((await outbox.findOne({ playerKey: mapped.playerKey }))?.status, 'SYNCED');
    assert.equal(worker.metricsSnapshot().replayed, 1);
    assert.equal(pg('select count(*) from eligibility.cup_player_level_projection_events;'), '2');
    console.log('PASS restart restored revision from same durable event, replay added no receiver event');

    const journalFilter = { actorId: actor!.id, playerKey: mapped.playerKey };
    const shown = (await service.audit(journalFilter)).items;
    assert.equal(shown.length, 1);
    assert.equal(shown[0].id, one.event.id);
    assert.equal(shown[0].actorId, actor!.id);
    assert.equal(shown[0].reason, dto.reason);
    const nextManual = { ratingNumeric: 4.70001, expectedLastEventId: one.event.id,
      reason: '=Synthetic spreadsheet formula must remain text', idempotencyKey: 'synthetic-manual-numeric-projection' };
    const changed = await service.change(mapped.playerKey, nextManual, actor);
    assert.equal(changed.state.rating, 'B+');
    assert.equal(changed.state.ratingNumeric, 4.70001);
    const pinned = (await service.audit(journalFilter, { export: true, displayedIds: shown.map(row => row.id) })).items;
    assert.deepEqual(pinned, shown, 'a new event cannot change the previously displayed export page');
    const all = (await service.audit(journalFilter, { export: true })).items;
    assert.equal(all.length, 2);
    assert.equal(all[0].id, changed.event.id);
    const csv = await exportPlayerRatingAudit(all, 'csv');
    assert.ok(csv.toString().includes(`"'=Synthetic spreadsheet formula must remain text"`));
    const book = new Workbook();
    await book.xlsx.read(Readable.from([await exportPlayerRatingAudit(all, 'xlsx')]));
    const sheet = book.worksheets[0];
    assert.equal(sheet.getCell('A2').value, changed.event.id);
    assert.equal(sheet.getCell('J2').value, 4.70001);
    assert.equal(sheet.getCell('L2').value, nextManual.reason);
    await worker.runCycle();
    const numericUpdate = await rehearsal();
    assert.equal(numericUpdate.currentLevel.numericValue, nextManual.ratingNumeric);
    assert.equal(numericUpdate.currentLevel.code, 'B+');
    assert.equal(numericUpdate.profileLevel.value, nextManual.ratingNumeric);
    assert.equal(numericUpdate.summaryLevel, 'B+');
    assert.equal(numericUpdate.events.length, 2);
    console.log('PASS manual numeric change, scoped denial, exact CSV/XLSX page and LK2 profile readback');

    process.env.PADLHUB_PLAYER_LEVEL_PROJECTION_ENABLED = 'false';
    const correction = new PlayerRatingsService(repo);
    const variants: Array<[number, number, PlayerRatingGrade, PlayerRatingGrade]> = [
      [358, 2.12345, 'D', 'D+'], [12, 4.12345, 'C+', 'B'], [3, 4.82345, 'B', 'B+'], [1, 5.82345, 'B+', 'A']
    ];
    const cohort = variants.flatMap(([count, number, before, after], variant) =>
      Array.from({ length: count }, (_, i) => ({ state: canonical(`synthetic-letter-${variant}-${i}`, number, before), after })));
    assert.equal(cohort.length, 374);
    await seed(cohort.map(({ state }) => state));
    for (let i = 0; i < cohort.length; i += 12) {
      await Promise.all(cohort.slice(i, i + 12).map(async ({ state, after }) => {
        const result = await correction.change(state.playerKey, packet(state), actor);
        assert.equal(result.state.ratingNumeric, state.ratingNumeric);
        assert.equal(result.event.delta, 0);
        assert.equal(result.event.gradeBefore, state.rating);
        assert.equal(result.event.gradeAfter, after);
      }));
    }
    const keys = cohort.map(({ state }) => state.playerKey);
    const afterStates = new Map((await states.find({ playerKey: { $in: keys } }).toArray()).map(s => [s.playerKey, s]));
    const afterCompat = new Map((await compatibility.find({ playerKey: { $in: keys } }).toArray()).map(s => [s.playerKey, s]));
    for (const { state, after } of cohort) {
      assert.equal(afterStates.get(state.playerKey)?.ratingNumeric, state.ratingNumeric);
      assert.equal(afterCompat.get(state.playerKey)?.ratingNumeric, state.ratingNumeric);
      assert.equal(afterStates.get(state.playerKey)?.rating, after);
      assert.equal(afterCompat.get(state.playerKey)?.rating, after);
    }
    assert.equal(await events.countDocuments({ 'player.key': { $in: keys }, 'change.delta': 0 }), 374);
    assert.equal(await outbox.countDocuments({ playerKey: { $in: keys } }), 0);
    assert.equal(await db.collection('rating_projection_outbox').countDocuments(), 0);
    console.log('PASS 374 synthetic corrections on Mongo replica set, 0 numeric differences, 0 Viva outbox rows');
  } finally {
    worker.onModuleDestroy();
    await repo.close();
    // Fresh process-specific fixture DB, on the hard-coded local test replica set only.
    await mongo.db(dbName).dropDatabase();
    await mongo.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
