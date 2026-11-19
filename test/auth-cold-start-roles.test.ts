import * as assert from 'node:assert/strict';
import { AuthService } from '../src/auth/auth.service';
import { AuthPersistenceService } from '../src/auth/auth-persistence.service';
import { Role } from '../src/common/rbac/role.enum';
import { PlayerRatingsController } from '../src/player-ratings/player-ratings.controller';
import { PlayerRatingsService } from '../src/player-ratings/player-ratings.service';
import { PlayerRatingStateDocument } from '../src/player-ratings/player-ratings.types';

// Synthetic data only. Mirrors Nest: every provider's onModuleInit of one module runs in parallel,
// and auth persistence becomes enabled only after its MongoDB connection settles.
const STATION_A = 'synthetic-station-a';
const now = '2026-10-01T00:00:00.000Z';

function storedPersistence(managerPermissions: string[]) {
  let enabled = false;
  const roles = new Map<string, any>([[Role.MANAGER, {
    id: Role.MANAGER, name: 'Управляющий', permissions: managerPermissions, stationIds: [], isSystem: true, createdAt: now, updatedAt: now
  }]]);
  const users = new Map<string, any>([
    ['stored-manager', { id: 'stored-manager', login: 'stored_manager', password: 'SyntheticManager123', title: 'Stored manager',
      roles: [Role.MANAGER], roleIds: [Role.MANAGER], stationIds: [STATION_A], connectorRoutes: [], active: true }]
  ]);
  return {
    onModuleInit: async () => { await new Promise(resolve => setTimeout(resolve, 20)); enabled = true; },
    isEnabled: () => enabled,
    loadUsers: async () => (enabled ? [...users.values()] : []),
    loadRoles: async () => (enabled ? [...roles.values()] : []),
    seedUsers: async () => undefined,
    seedRoles: async () => undefined,
    findUserById: async (id: string) => (enabled ? users.get(id) ?? null : null),
    upsertUser: async (row: any) => { users.set(row.id, structuredClone(row)); },
    upsertRole: async (row: any) => { roles.set(row.id, structuredClone(row)); },
    appendAudit: async () => undefined
  };
}

// Issue a valid staff token without calling login(), so the first request is the token resolution itself.
function token(auth: AuthService, sub: string): string {
  const iat = Math.floor(Date.now() / 1000);
  return (auth as any).signToken({ sub, iat, exp: iat + 3600, typ: 'admin' });
}

function ratings() {
  let current: PlayerRatingStateDocument = {
    playerKey: 'client:synthetic-1', clientId: 'synthetic-1', name: 'Synthetic Player', nameSearch: 'synthetic player',
    ratingNumeric: 3.2, rating: 'C', ownership: 'CUP_CANONICAL', source: 'CUP', schemaVersion: 1, createdAt: now, updatedAt: now,
    lastEventId: 'rating_evt:seed', lastEventAt: now, lastEventType: 'RATING_INITIAL_IMPORTED', lastSource: 'IMPORT',
    lastChangedBy: { id: 'import', name: 'Import', type: 'IMPORT' }
  };
  const events: any[] = [];
  const repository: any = {
    connect: async () => undefined, close: async () => undefined,
    stateByKey: async (key: string) => (key === current.playerKey ? current : null),
    eventByIdempotencyKey: async (key: string) => events.find(event => event.idempotencyKey === key) ?? null,
    latestOutbox: async () => null,
    runAtomicChange: async (input: any) => { events.push(input.event); current = input.nextState; return 'ok'; },
    isDuplicateKey: () => false
  };
  return { controller: new PlayerRatingsController(new PlayerRatingsService(repository), {} as any), events, state: () => current };
}

async function coldStart(managerPermissions: string[]) {
  const persistence = storedPersistence(managerPermissions);
  const auth = new AuthService(persistence as unknown as AuthPersistenceService);
  // Nest calls the hooks of one module concurrently.
  await Promise.all([auth.onModuleInit(), persistence.onModuleInit()]);
  return auth;
}

async function firstRequest(auth: AuthService) {
  const resolved = await auth.resolveUserFromRequest({ headers: { authorization: `Bearer ${token(auth, 'stored-manager')}` } } as any);
  assert.equal(resolved.source, 'token');
  return resolved.user!;
}

const request: any = { get: () => undefined, protocol: 'http' };
const change = (state: PlayerRatingStateDocument, key: string) => ({
  ratingNumeric: 3.4, reason: 'Synthetic correction after a control match', expectedLastEventId: state.lastEventId, idempotencyKey: key
});

async function main(): Promise<void> {
  const saved = { ...process.env };
  try {
    process.env.ADMIN_AUTH_SECRET = 'synthetic-cold-start-secret';
    process.env.ADMIN_AUTH_USERS_JSON = JSON.stringify([
      { id: 'synthetic-root', login: 'synthetic_root', password: 'SyntheticRoot123', roleIds: ['SUPER_ADMIN'], stationIds: [] }
    ]);

    // Stored role without write: denied from the very first request, and nothing is written.
    const denied = await coldStart(['audit:read', 'player-ratings:read']);
    const withoutGrant = await firstRequest(denied);
    assert.equal(withoutGrant.permissions?.includes('player-ratings:write'), false, 'stored role, not defaults, decides the first request');
    const r1 = ratings();
    await assert.rejects(r1.controller.change(request, r1.state().playerKey, change(r1.state(), 'synthetic-cold-denied-1'), withoutGrant),
      (error: any) => error.status === 403);
    assert.equal(r1.events.length, 0, 'a denied attempt writes no journal event');

    // Stored role with write: the first request changes the level from the employee's station.
    const granted = await coldStart(['audit:read', 'player-ratings:read', 'player-ratings:write']);
    const withGrant = await firstRequest(granted);
    const r2 = ratings();
    const result = await r2.controller.change(request, r2.state().playerKey, change(r2.state(), 'synthetic-cold-granted-1'), withGrant);
    assert.equal(result.event.actor.stationId, STATION_A);
    assert.equal(r2.events.length, 1);
    // Persistence that becomes available only after startup: the request path still loads stored roles.
    const late = storedPersistence(['audit:read', 'player-ratings:read']);
    const lateAuth = new AuthService({ ...late, onModuleInit: async () => undefined } as unknown as AuthPersistenceService);
    await lateAuth.onModuleInit();
    await late.onModuleInit();
    const lateUser = await firstRequest(lateAuth);
    assert.equal(lateUser.permissions?.includes('player-ratings:write'), false, 'late persistence still replaces defaults');
    const r3 = ratings();
    await assert.rejects(r3.controller.change(request, r3.state().playerKey, change(r3.state(), 'synthetic-cold-late-1'), lateUser),
      (error: any) => error.status === 403);
    assert.equal(r3.events.length, 0);
    console.log('cold start: stored roles decide the first request');
  } finally {
    process.env = saved;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
