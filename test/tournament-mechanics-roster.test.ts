import assert = require('node:assert/strict');
import { test } from 'node:test';
import { VivaAdminService } from '../src/integrations/viva/viva-admin.service';
import { TournamentsService } from '../src/tournaments/tournaments.service';
import { TournamentsPersistenceService } from '../src/tournaments/tournaments-persistence.service';

const exerciseId = '10000000-0000-4000-8000-000000000001';
const firstClient = '10000000-0000-4000-8000-000000000002';
const secondClient = '10000000-0000-4000-8000-000000000003';
const thirdClient = '10000000-0000-4000-8000-000000000004';
const firstBooking = '20000000-0000-4000-8000-000000000001';
const secondBooking = '20000000-0000-4000-8000-000000000002';
const thirdBooking = '20000000-0000-4000-8000-000000000003';

test('active bookings use the exact exercise and require a complete, consistent result', async () => {
  const admin = Object.create(VivaAdminService.prototype) as VivaAdminService;
  Object.assign(admin, {
    resolveAccessToken: async () => 'fixture',
    getResolvedSettings: async () => ({ config: { baseUrl: 'https://example.invalid' } })
  });
  const paths: string[] = [];
  Object.assign(admin, {
    fetchAdminJson: async (path: string) => {
      paths.push(path);
      const page = Number(new URL(path, 'https://example.invalid').searchParams.get('page'));
      return { number: page, totalPages: 2, totalElements: 101,
        content: Array.from({ length: page === 0 ? 100 : 1 }, () => ({ synthetic: true })) };
    }
  });
  assert.equal((await admin.readActiveExerciseBookings(exerciseId)).length, 101);
  assert.deepEqual(paths, [0, 1].map(page =>
    `/api/v1/exercises/${exerciseId}/bookings?showCancelled=false&page=${page}&size=100`
  ));
  Object.assign(admin, { fetchAdminJson: async () => ({ content: [], number: 0, totalPages: 0, totalElements: 0 }) });
  assert.deepEqual(await admin.readActiveExerciseBookings(exerciseId), []);
  Object.assign(admin, { fetchAdminJson: async () => ({ content: [], number: 0, totalPages: 1, totalElements: 1 }) });
  await assert.rejects(admin.readActiveExerciseBookings(exerciseId), { status: 503 });
  Object.assign(admin, { fetchAdminJson: async () => ({ content: [] }) });
  await assert.rejects(admin.readActiveExerciseBookings(exerciseId), { status: 503 });
});

test('active blank names and duplicate display names retain distinct Viva client IDs', async () => {
  const viva = Object.create(VivaAdminService.prototype) as VivaAdminService;
  const records = [
    { id: firstBooking, exerciseId, client: { id: firstClient, firstName: '' } },
    { id: secondBooking, exerciseId, client: { id: secondClient, firstName: 'Synthetic' },
      transactionStatus: { transactionStatus: 'PAID' } },
    { id: thirdBooking, exerciseId, clientId: thirdClient, firstName: 'Synthetic', ratingNumeric: 3.25,
      photo: '/synthetic/avatar.png' },
    { id: 'cancelled', status: 'CANCELLED', client: { id: 'unused' } },
    { id: 'waiting', state: 'WAITLIST', client: { id: 'unused' } }
  ];
  Object.assign(viva, { readActiveExerciseBookings: async () => records });
  const roster = await viva.readMechanicsParticipants(exerciseId);
  assert.deepEqual(roster.map(row => [row.id, row.vivaBookingId, row.name]), [
    [firstClient, firstBooking, 'Участник №1'],
    [secondClient, secondBooking, 'Synthetic'],
    [thirdClient, thirdBooking, 'Synthetic']
  ]);
  assert.ok(roster.every(row => !('phone' in row)));
  assert.equal(roster[1]?.paymentStatus, 'PAID');
  assert.equal(roster[2]?.levelLabel, '3.25');
  assert.equal(roster[2]?.avatarUrl, '/synthetic/avatar.png');
  records.push({ id: 'wrong-target', exerciseId: firstClient, client: { id: firstClient, firstName: '' } });
  await assert.rejects(viva.readMechanicsParticipants(exerciseId), { status: 503 });
});

test('mechanics reads preserve active players while refresh persists exactly one exercise and no checkout mutation', async () => {
  const service = Object.create(TournamentsService.prototype) as TournamentsService;
  const fixture = {
    id: 'synthetic-tournament', exerciseId, sourceTournamentId: 'source-record-id',
    isPublic: true, trainerId: thirdClient, allowedManagerPhones: [] as string[],
    details: { booking: { vivaExerciseId: exerciseId, pendingJoinPayments: [{
      transactionId: 'synthetic', state: 'OWNER_COMPLETED', providerBookingId: thirdBooking,
      ownerCommand: { kind: 'SUBSCRIPTION' }, ownerReceipt: { kind: 'COPAY', bookingId: thirdBooking }
    }] } },
    participants: [{ id: 'owner:synthetic', paymentStatus: 'PAID' }],
  };
  const original = structuredClone(fixture);
  const mappings = [{ $eq: ['$exerciseId', exerciseId] }];
  const rosterAccessChecks = [{ $eq: ['$allowedManagerPhones', []] }];
  let organizer = true;
  let player = thirdClient;
  let readCount = 0;
  let writes = 0;
  let saved: any = null;
  const holds = [{
    clientId: firstClient, copayBookingId: firstBooking, exerciseId,
    ownerSubscription: true, state: 'PROVIDER_CREATE_PENDING'
  }];
  Object.assign(service, {
    assertCheckoutTenant: (value: string) => assert.equal(value, 'synthetic-tenant'),
    requireTournamentLkAccessToken: async () => 'fixture',
    hasTournamentHostingAccess: () => organizer,
    fetchVivaOwnProfile: async () => ({ id: player }),
    vivaMechanicsRosterCache: new Map(),
    vivaMechanicsRosterInFlight: new Map(),
    getPendingJoinPayments: () => holds,
    vivaAdminService: { readMechanicsParticipants: async (id: string) => {
      assert.equal(id, exerciseId);
      readCount += 1;
      return [
        { id: firstClient, vivaBookingId: firstBooking, name: 'Участник №1' },
        { id: secondClient, vivaBookingId: secondBooking, name: 'Synthetic', paymentStatus: 'PAID' },
        { id: thirdClient, vivaBookingId: thirdBooking, name: 'Synthetic checkout client' }
      ];
    } },
    tournamentsPersistence: {
      findCheckoutTournamentByExerciseId: async (id: string) =>
        id === exerciseId ? { tournament: fixture, mappingChecks: mappings, rosterAccessChecks } : null,
      readVivaMechanicsRoster: async () => saved,
      saveVivaMechanicsRoster: async (id: string, checks: unknown, roster: unknown) => {
        assert.equal(id, fixture.id);
        assert.deepEqual(checks, [...mappings, ...rosterAccessChecks]);
        saved = roster;
        writes += 1;
        return true;
      }
    }
  });
  const input = { exerciseId, refresh: true, tenantKeyHeader: 'synthetic-tenant' };
  const first = await service.getVivaMechanicsRoster(input);
  assert.equal(first.refreshed, true);
  assert.deepEqual(first.participants.map(row => [row.id, row.confirmationPending]), [
    [firstClient, true], [secondClient, false], [thirdClient, false]
  ]);
  assert.equal(first.participants[2]?.paymentStatus, 'PAID');
  assert.equal(saved.participants[1].id, secondClient);
  assert.equal(saved.participants[0].confirmationPending, undefined);
  assert.ok(first.participants.every(row => row.vivaBookingId === undefined));
  assert.deepEqual(fixture, original);
  assert.equal((await service.getVivaMechanicsRoster(input)).refreshed, false);
  assert.equal(writes, 1);
  fixture.details.booking.vivaExerciseId = firstClient;
  await assert.rejects(service.getVivaMechanicsRoster(input), { status: 409 });
  fixture.details.booking.vivaExerciseId = exerciseId;
  player = firstClient;
  assert.equal((await service.getVivaMechanicsRoster({ ...input, refresh: false })).participants[0].vivaBookingId, undefined);
  player = secondClient;
  assert.equal((await service.getVivaMechanicsRoster({ ...input, refresh: false })).participants[1].vivaBookingId, secondBooking);
  holds.push({ clientId: secondClient, copayBookingId: '', exerciseId,
    ownerSubscription: false, state: 'PROVIDER_RESULT_UNKNOWN' });
  assert.equal((await service.getVivaMechanicsRoster({ ...input, refresh: false })).participants[1].vivaBookingId, undefined);
  holds.pop();
  fixture.allowedManagerPhones.push('synthetic-manager');
  await assert.rejects(service.getVivaMechanicsRoster(input), { status: 403 });
  fixture.allowedManagerPhones.length = 0;
  organizer = false;
  player = thirdClient;
  await assert.rejects(service.getVivaMechanicsRoster(input), { status: 403 });
  fixture.isPublic = false;
  assert.equal((await service.getVivaMechanicsRoster({ ...input, refresh: false })).participants.length, 3);
  player = firstClient;
  await assert.rejects(service.getVivaMechanicsRoster({ ...input, refresh: false }), { status: 403 });
  assert.equal(readCount, 1);
});

test('Mongo write is fenced by the document ID, exercise mapping and snapshot freshness', async () => {
  const persistence = Object.create(TournamentsPersistenceService.prototype) as TournamentsPersistenceService;
  const id = '123456789012345678901234';
  const mapping = { $eq: ['$exerciseId', exerciseId] };
  const roster = { exerciseId, fetchedAt: '2026-01-01T00:00:00.000Z', participants: [] };
  Object.assign(persistence, {
    collection: async () => ({
      updateOne: async (filter: any, update: unknown) => {
        assert.equal(filter.$and[0].$or[0].id, id);
        assert.equal(filter.$and[1].$or[1]['vivaMechanicsRoster.fetchedAt'].$lte, roster.fetchedAt);
        assert.deepEqual(filter.$expr, { $and: [mapping] });
        assert.deepEqual(update, { $set: { vivaMechanicsRoster: roster } });
        return { acknowledged: true, matchedCount: 0 };
      }
    })
  });
  assert.equal(await persistence.saveVivaMechanicsRoster(id, [mapping], roster), false);
});
