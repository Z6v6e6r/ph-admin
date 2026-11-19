import * as assert from 'node:assert/strict';
import { AuthService } from '../src/auth/auth.service';
import { AuthPersistenceService } from '../src/auth/auth-persistence.service';
import { Role } from '../src/common/rbac/role.enum';
import { PlayerRatingsController } from '../src/player-ratings/player-ratings.controller';
import { PlayerRatingsService } from '../src/player-ratings/player-ratings.service';
import { PlayerRatingStateDocument } from '../src/player-ratings/player-ratings.types';

// Synthetic data only. A configured auth store that is unreachable at startup, then restored.
const STATION_A = 'synthetic-station-a';
const now = '2026-10-01T00:00:00.000Z';

function outagePersistence() {
  let reachable = false;
  let enabled = false;
  let midRunFailure = false;
  const roles = new Map<string, any>([
    [Role.MANAGER, { id: Role.MANAGER, name: 'Управляющий', permissions: ['audit:read', 'player-ratings:read'], stationIds: [], isSystem: true, createdAt: now, updatedAt: now }],
    ['LEVEL_EDITOR', { id: 'LEVEL_EDITOR', name: 'Редактор уровней', permissions: ['audit:read', 'player-ratings:read', 'player-ratings:write'], stationIds: [], isSystem: false, createdAt: now, updatedAt: now }]
  ]);
  const users = new Map<string, any>([
    ['env-manager', { id: 'env-manager', login: 'env_manager', password: 'SyntheticManager123', roles: [Role.MANAGER], roleIds: [Role.MANAGER], stationIds: [STATION_A], connectorRoutes: [], active: true }],
    ['editor-a', { id: 'editor-a', login: 'editor_a', password: 'SyntheticEditor123', roles: [], roleIds: ['LEVEL_EDITOR'], stationIds: [STATION_A], connectorRoutes: [], active: true }]
  ]);
  const guard = () => { if (midRunFailure) throw new Error('MongoServerSelectionError: synthetic outage'); };
  return {
    control: {
      restore: () => { reachable = true; },
      failMidRun: () => { midRunFailure = true; }
    },
    persistence: {
      onModuleInit: async () => { enabled = reachable; },
      isConfigured: () => true,
      isEnabled: () => enabled,
      ensureConnected: async () => { if (!enabled && reachable) enabled = true; return enabled; },
      loadUsers: async () => { guard(); return enabled ? [...users.values()] : []; },
      loadRoles: async () => { guard(); return enabled ? [...roles.values()] : []; },
      seedUsers: async () => undefined,
      seedRoles: async () => undefined,
      findUserById: async (id: string) => { guard(); return enabled ? users.get(id) ?? null : null; },
      upsertUser: async () => undefined,
      upsertRole: async () => undefined,
      appendAudit: async () => undefined
    }
  };
}

function ratings() {
  let current: PlayerRatingStateDocument = {
    playerKey: 'client:synthetic-1', clientId: 'synthetic-1', name: 'Synthetic Player', nameSearch: 'synthetic player',
    ratingNumeric: 3.35, rating: 'C', ownership: 'CUP_CANONICAL', source: 'CUP', schemaVersion: 1, createdAt: now, updatedAt: now,
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

const request: any = { get: () => undefined, protocol: 'http' };
const change = (state: PlayerRatingStateDocument, key: string) => ({
  ratingNumeric: 3.48, reason: 'Synthetic correction during an auth store outage', expectedLastEventId: state.lastEventId, idempotencyKey: key
});
const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } } as any);

async function assertUnchanged(r: ReturnType<typeof ratings>, user: any, key: string, statuses: number[]) {
  await assert.rejects(r.controller.change(request, r.state().playerKey, change(r.state(), key), user),
    (error: any) => statuses.includes(error.status));
  assert.equal(r.state().ratingNumeric, 3.35);
  assert.equal(r.state().lastEventId, 'rating_evt:seed');
  assert.equal(r.events.filter(event => event.source.domain === 'ADMIN_MANUAL').length, 0);
}

async function main(): Promise<void> {
  const saved = { ...process.env };
  try {
    process.env.ADMIN_AUTH_SECRET = 'synthetic-outage-secret';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=1';
    // Env users as on a deployment: the manager carries the default MANAGER role, plus an env superadmin.
    process.env.ADMIN_AUTH_USERS_JSON = JSON.stringify([
      { id: 'env-manager', login: 'env_manager', password: 'SyntheticManager123', roleIds: [Role.MANAGER], stationIds: [STATION_A] },
      { id: 'env-root', login: 'env_root', password: 'SyntheticRoot123', roleIds: [Role.SUPER_ADMIN], stationIds: [] }
    ]);
    const { persistence, control } = outagePersistence();
    const auth = new AuthService(persistence as unknown as AuthPersistenceService);
    await Promise.all([auth.onModuleInit(), persistence.onModuleInit()]);
    const r = ratings();

    // Store unavailable: neither the manager nor an env superadmin can change the level.
    const manager = (await auth.login('env_manager', 'SyntheticManager123')).user;
    assert.equal(manager.permissions?.includes('player-ratings:write'), false, 'defaults do not grant write during an outage');
    assert.equal(manager.storedRightsConfirmed, false);
    await assertUnchanged(r, manager, 'synthetic-outage-manager-1', [403, 503]);
    const rootSession = await auth.login('env_root', 'SyntheticRoot123');
    const root = (await auth.resolveUserFromRequest(bearer(rootSession.accessToken))).user!;
    await assertUnchanged(r, root, 'synthetic-outage-root-1', [503]);

    // Tokens issued during the outage: the first request after recovery is decided by stored records.
    const outageManagerToken = (await auth.login('env_manager', 'SyntheticManager123')).accessToken;
    control.restore();
    // The very first request after recovery: env-root exists only in ADMIN_AUTH_USERS_JSON, not in the store.
    const recoveredRoot = await auth.resolveUserFromRequest(bearer(rootSession.accessToken));
    assert.equal(recoveredRoot.user?.permissions?.includes('*') ?? false, false, 'unstored env superadmin gets no grants after recovery');
    if (recoveredRoot.user) await assertUnchanged(r, recoveredRoot.user, 'synthetic-recovered-token-root-1', [401, 403, 503]);
    const recoveredManager = (await auth.resolveUserFromRequest(bearer(outageManagerToken))).user!;
    assert.equal(recoveredManager.storedRightsConfirmed, undefined);
    assert.deepEqual(recoveredManager.roleIds, [Role.MANAGER]);
    assert.equal(recoveredManager.permissions?.includes('player-ratings:write'), false, 'stored MANAGER role, not defaults');
    await assertUnchanged(r, recoveredManager, 'synthetic-recovered-token-manager-1', [403]);

    // Fresh logins after recovery.
    const managerAfter = (await auth.resolveUserFromRequest(bearer((await auth.login('env_manager', 'SyntheticManager123')).accessToken))).user!;
    assert.equal(managerAfter.storedRightsConfirmed, undefined, 'rights are confirmed after recovery');
    await assertUnchanged(r, managerAfter, 'synthetic-restored-manager-1', [403]);
    const editor = (await auth.resolveUserFromRequest(bearer((await auth.login('editor_a', 'SyntheticEditor123')).accessToken))).user!;
    const applied = await r.controller.change(request, r.state().playerKey, change(r.state(), 'synthetic-restored-editor-1'), editor);
    assert.equal(applied.event.actor.stationId, STATION_A);
    assert.equal(r.state().ratingNumeric, 3.48);
    assert.equal(r.events.length, 1);

    // Store fails while running: token resolution cannot confirm the user and fails closed.
    const editorToken = (await auth.login('editor_a', 'SyntheticEditor123')).accessToken;
    control.failMidRun();
    await assert.rejects(auth.resolveUserFromRequest(bearer(editorToken)));
    assert.equal(r.events.length, 1);
    console.log('auth store outage: explicit grants are denied until stored rights are confirmed, then restored');
  } finally {
    process.env = saved;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
