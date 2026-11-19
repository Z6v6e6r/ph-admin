import * as assert from 'node:assert/strict';
import { AuthService } from '../src/auth/auth.service';
import { AuthPersistenceService } from '../src/auth/auth-persistence.service';
import { Role } from '../src/common/rbac/role.enum';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { exportPlayerRatingAudit } from '../src/player-ratings/player-rating-audit-export';
import { PlayerRatingsController } from '../src/player-ratings/player-ratings.controller';
import { PlayerRatingsService, ratingJournalScope, resolveRatingWriteStation } from '../src/player-ratings/player-ratings.service';
import { PlayerRatingStateDocument } from '../src/player-ratings/player-ratings.types';

// Synthetic stations and accounts only.
const STATION_A = 'synthetic-station-a';
const STATION_B = 'synthetic-station-b';

function initialState(): PlayerRatingStateDocument {
  return {
    playerKey: 'client:synthetic-1', clientId: 'synthetic-1', name: 'Synthetic Player', nameSearch: 'synthetic player',
    ratingNumeric: 3.2, rating: 'C', ownership: 'CUP_CANONICAL', source: 'CUP', schemaVersion: 1,
    createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', lastEventId: 'rating_evt:seed',
    lastEventAt: '2026-11-01T10:00:00.000Z', lastEventType: 'RATING_INITIAL_IMPORTED', lastSource: 'IMPORT',
    lastChangedBy: { id: 'import', name: 'Import', type: 'IMPORT' }
  };
}

function read(document: any, path: string): unknown {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), document);
}

function matches(document: any, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([path, condition]) => {
    if (path === 'occurredAt' || path.startsWith('$')) return true;
    const value = read(document, path);
    if (condition && typeof condition === 'object' && Array.isArray(condition.$in)) return condition.$in.includes(value);
    return value === condition;
  });
}

function harness() {
  let current = initialState();
  const events: any[] = [];
  const repository: any = {
    connect: async () => undefined,
    close: async () => undefined,
    stateByKey: async (key: string) => (key === current.playerKey ? current : null),
    eventById: async (id: string) => events.find(event => event.id === id) ?? null,
    eventByIdempotencyKey: async (key: string) => events.find(event => event.idempotencyKey === key) ?? null,
    latestOutbox: async () => null,
    listEvents: async (filter: Record<string, any>, limit: number) =>
      events.filter(event => matches(event, filter)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit),
    runAtomicChange: async (input: any) => { events.push(input.event); current = input.nextState; return 'ok'; },
    isDuplicateKey: () => false
  };
  return { service: new PlayerRatingsService(repository), events, state: () => current };
}

function authHarness() {
  process.env.ADMIN_AUTH_SECRET = 'synthetic-rating-scope-secret';
  process.env.ADMIN_AUTH_USERS_JSON = JSON.stringify([
    { id: 'synthetic-root', login: 'synthetic_root', password: 'SyntheticRoot123', roleIds: ['SUPER_ADMIN'], stationIds: [] }
  ]);
  const users = new Map<string, any>();
  const roles = new Map<string, any>();
  const persistence = {
    isEnabled: () => true,
    loadUsers: async () => [...users.values()],
    loadRoles: async () => [...roles.values()],
    seedUsers: async (rows: any[]) => { rows.forEach(row => users.set(row.id, structuredClone(row))); },
    seedRoles: async (rows: any[]) => { rows.forEach(row => { if (!roles.has(row.id)) roles.set(row.id, structuredClone(row)); }); },
    findUserById: async (id: string) => users.get(id) ?? null,
    upsertUser: async (row: any) => { users.set(row.id, structuredClone(row)); },
    upsertRole: async (row: any) => { roles.set(row.id, structuredClone(row)); },
    appendAudit: async () => undefined
  };
  return { roles, auth: new AuthService(persistence as unknown as AuthPersistenceService) };
}

async function sessionUser(auth: AuthService, login: string, password: string): Promise<RequestUser> {
  const session = await auth.login(login, password);
  const resolved = await auth.resolveUserFromRequest({ headers: { authorization: `Bearer ${session.accessToken}` } } as any);
  assert.equal(resolved.user?.authSource, 'token');
  return resolved.user!;
}

const request: any = { get: () => undefined, protocol: 'http' };
const change = (state: PlayerRatingStateDocument, ratingNumeric: number, key: string, stationId?: string) => ({
  ratingNumeric, reason: 'Synthetic correction after a control match', expectedLastEventId: state.lastEventId,
  idempotencyKey: key, ...(stationId ? { stationId } : {})
});

async function standardRolesChangeFromTheirStation(): Promise<void> {
  const saved = { ...process.env };
  try {
    const { auth } = authHarness();
    await auth.onModuleInit();
    const root = await sessionUser(auth, 'synthetic_root', 'SyntheticRoot123');
    await auth.createAdminUser({ login: 'manager_a', password: 'SyntheticManager123', title: 'Manager A', roleIds: [Role.MANAGER], stationIds: [STATION_A] } as any, root);
    await auth.createAdminUser({ login: 'admin_b', password: 'SyntheticAdmin123', title: 'Admin B', roleIds: [Role.STATION_ADMIN], stationIds: [STATION_B] } as any, root);
    await auth.createAdminUser({ login: 'manager_ab', password: 'SyntheticManager123', title: 'Manager AB', roleIds: [Role.MANAGER], stationIds: [STATION_A, STATION_B] } as any, root);
    await auth.createAdminUser({ login: 'manager_global', password: 'SyntheticManager123', title: 'Manager Global', roleIds: [Role.MANAGER], stationIds: [] } as any, root);
    const managerA = await sessionUser(auth, 'manager_a', 'SyntheticManager123');
    const adminB = await sessionUser(auth, 'admin_b', 'SyntheticAdmin123');
    const managerAB = await sessionUser(auth, 'manager_ab', 'SyntheticManager123');
    const managerGlobal = await sessionUser(auth, 'manager_global', 'SyntheticManager123');
    assert.deepEqual(managerA.permissionStationScopes?.['player-ratings:write'], [STATION_A]);
    assert.deepEqual(adminB.permissionStationScopes?.['player-ratings:write'], [STATION_B]);

    const h = harness();
    const controller = new PlayerRatingsController(h.service, {} as any);

    // Station manager: card read, change on behalf of its only station, cannot claim another station.
    assert.equal((await controller.get(request, h.state().playerKey, managerA)).ratingNumeric, 3.2);
    await assert.rejects(controller.change(request, h.state().playerKey, change(h.state(), 3.4, 'synthetic-manager-a-foreign', STATION_B), managerA),
      (error: any) => error.status === 403);
    const byManager = await controller.change(request, h.state().playerKey, change(h.state(), 3.4, 'synthetic-manager-a-change-1'), managerA);
    assert.equal(byManager.event.actor.stationId, STATION_A);
    assert.equal(h.events.at(-1).actor.stationId, STATION_A, 'durable event records the acting station');
    // The exact retry returns the same event.
    const retry = await controller.change(request, h.state().playerKey, change(initialState(), 3.4, 'synthetic-manager-a-change-1'), managerA);
    assert.equal(retry.event.id, byManager.event.id);
    assert.equal(h.events.length, 1);

    // Station administrator has no journal grant, but changes the shared level from its station.
    const byAdmin = await controller.change(request, h.state().playerKey, change(h.state(), 3.6, 'synthetic-admin-b-change-1'), adminB);
    assert.equal(byAdmin.event.actor.stationId, STATION_B);
    assert.equal(h.state().ratingNumeric, 3.6, 'the canonical level is shared by every station');
    assert.throws(() => ratingJournalScope(adminB), (error: any) => error.status === 403);

    // A multi-station writer must choose a station from its scope.
    await assert.rejects(controller.change(request, h.state().playerKey, change(h.state(), 3.7, 'synthetic-manager-ab-missing'), managerAB),
      (error: any) => error.status === 400 && error.response?.code === 'RATING_STATION_REQUIRED');
    assert.equal(resolveRatingWriteStation(managerAB, STATION_B), STATION_B);
    assert.equal(resolveRatingWriteStation(managerGlobal, undefined), undefined);
    assert.equal(resolveRatingWriteStation(managerGlobal, STATION_B), STATION_B);
    assert.throws(() => resolveRatingWriteStation(managerAB, 'synthetic-station-c'), (error: any) => error.status === 403);

    // Journal: station staff see only changes made from their stations; global staff see all.
    const journalA = await controller.journal(request, {}, managerA);
    assert.deepEqual(journalA.items.map(row => row.stationId), [STATION_A]);
    const journalAB = await controller.journal(request, {}, managerAB);
    assert.deepEqual(journalAB.items.map(row => row.stationId).sort(), [STATION_A, STATION_B]);
    const journalGlobal = await controller.journal(request, {}, managerGlobal);
    assert.equal(journalGlobal.items.length, 2);
    // A displayed-page export cannot reach rows outside the viewer's stations.
    await assert.rejects(h.service.audit({}, { export: true, displayedIds: [byAdmin.event.id], stationScope: ratingJournalScope(managerA) }),
      (error: any) => error.status === 409);

    const csv = (await exportPlayerRatingAudit(journalA.items, 'csv')).toString('utf8');
    const [header, row] = csv.replace(/^﻿/, '').trim().split('\r\n');
    assert.match(header, /"Сотрудник","Станция","ID игрока"/);
    assert.match(row, new RegExp(`"Manager A","${STATION_A}","client:synthetic-1","Synthetic Player","3.2","C","3.4","C"`));
    console.log('standard manager and station administrator change levels from their stations; journal is station-scoped');
  } finally {
    process.env = saved;
  }
}

async function persistedRoleWithoutWriteNeedsTheGrant(): Promise<void> {
  const saved = { ...process.env };
  try {
    const { auth, roles } = authHarness();
    // A deployed environment keeps its stored system role; new defaults do not overwrite it.
    roles.set(Role.MANAGER, {
      id: Role.MANAGER, name: 'Управляющий', permissions: ['audit:read', 'player-ratings:read'], stationIds: [],
      isSystem: true, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z'
    });
    await auth.onModuleInit();
    const root = await sessionUser(auth, 'synthetic_root', 'SyntheticRoot123');
    await auth.createAdminUser({ login: 'manager_a', password: 'SyntheticManager123', roleIds: [Role.MANAGER], stationIds: [STATION_A] } as any, root);
    const h = harness();
    const controller = new PlayerRatingsController(h.service, {} as any);
    const before = await sessionUser(auth, 'manager_a', 'SyntheticManager123');
    assert.equal((await controller.get(request, h.state().playerKey, before)).rating, 'C', 'station-scoped read works');
    await assert.rejects(controller.change(request, h.state().playerKey, change(h.state(), 3.4, 'synthetic-stored-role-1'), before),
      (error: any) => error.status === 403);
    // The exact missing setting: add player-ratings:write to the stored role.
    await auth.updateAdminRole(Role.MANAGER, { permissions: ['audit:read', 'player-ratings:read', 'player-ratings:write'] } as any, root);
    const after = await sessionUser(auth, 'manager_a', 'SyntheticManager123');
    assert.equal((await controller.change(request, h.state().playerKey, change(h.state(), 3.4, 'synthetic-stored-role-2'), after)).event.actor.stationId, STATION_A);
    // Disjoint role and account stations remain a denial.
    await auth.updateAdminRole(Role.MANAGER, { stationIds: [STATION_B] } as any, root);
    const disjoint = await sessionUser(auth, 'manager_a', 'SyntheticManager123');
    await assert.rejects(controller.change(request, h.state().playerKey, change(h.state(), 3.5, 'synthetic-stored-role-3'), disjoint),
      (error: any) => error.status === 403);
    assert.throws(() => ratingJournalScope(disjoint), (error: any) => error.status === 403);
    console.log('stored role without write is denied until player-ratings:write is added');
  } finally {
    process.env = saved;
  }
}

async function main(): Promise<void> {
  await standardRolesChangeFromTheirStation();
  await persistedRoleWithoutWriteNeedsTheGrant();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
