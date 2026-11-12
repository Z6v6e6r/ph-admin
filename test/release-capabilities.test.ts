import * as assert from 'node:assert/strict';
import { maxOutboxMode, releaseCapabilities, validateReleaseCapabilities } from '../src/common/release-capabilities';
import { SupportService } from '../src/support/support.service';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { SupportController } from '../src/support/support.controller';
import { SupportConnectorRoute as Route, SupportOutboxStatus as Status } from '../src/support/support.types';
import { CommunitiesService } from '../src/communities/communities.service';
import { Role } from '../src/common/rbac/role.enum';

async function main() {
  assert.equal(maxOutboxMode({}), 'legacy');
  assert.equal(maxOutboxMode({ SUPPORT_MAX_OUTBOX_MODE: 'receipt-v1' }), 'receipt-v1');
  assert.throws(() => maxOutboxMode({ SUPPORT_MAX_OUTBOX_MODE: 'fallback' }), /INVALID/);
  assert.deepEqual(releaseCapabilities({}), { locationRecommendationPhotosEnabled: false, notificationScenariosEnabled: false, communityPoliciesEnabled: false, communityPolicyTypesEnabled: [] });
  for (const key of ['PHAB_LOCATION_PHOTOS_ENABLED', 'PHAB_NOTIFICATION_SCENARIOS_ENABLED', 'PHAB_COMMUNITY_POLICIES_ENABLED']) {
    assert.throws(() => releaseCapabilities({ [key]: 'perhaps' }), /INVALID/);
  }
  const previous = { ...process.env };
  try {
    delete process.env.SUPPORT_MAX_OUTBOX_MODE;
    delete process.env.PHAB_COMMUNITY_POLICIES_ENABLED;
    delete process.env.SUPPORT_INTEGRATION_TOKEN;
    process.env.PHAB_LOCATION_PHOTOS_ENABLED = 'invalid';
    assert.throws(validateReleaseCapabilities, /PHAB_LOCATION_PHOTOS_ENABLED_INVALID/);
    delete process.env.PHAB_LOCATION_PHOTOS_ENABLED;
    validateReleaseCapabilities();
    for (const connector of [Route.MAX_BOT, Route.MAX_ACADEMY_BOT]) {
      const seed = { id: 'synthetic-legacy', connector, dialogId: 'synthetic-dialog', clientId: 'synthetic-client',
        text: 'synthetic', createdAt: new Date().toISOString(), status: Status.PENDING, attempts: 0 };
      let stored: any = { ...structuredClone(seed), _id: 'synthetic-mongo-id' };
      const persistence = new SupportPersistenceService() as any;
      persistence.backendConfigs = [{ key: 'max' }];
      persistence.backendStates.set('max', { config: { key: 'max', collections: { outbox: 'synthetic_outbox' } },
        db: { collection: (name: string) => {
          assert.equal(name, 'synthetic_outbox_generation_control');
          return { findOne: async () => null };
        } } });
      persistence.resolveTargetBackendForConnector = () => assert.fail('Legacy MAX must not fall back to another queue');
      persistence.deleteFromOtherBackends = () => assert.fail('Legacy MAX must not clean another queue');
      persistence.collection = () => ({
        findOne: async (filter: any, options: any) => {
          assert.equal(filter.id, seed.id); assert.equal(filter.connector, connector);
          assert.equal(options.readConcern.level, 'majority'); assert.equal(options.readPreference, 'primary');
          return structuredClone(stored);
        },
        updateOne: async (filter: any, update: any, options: any) => {
          assert.ok(update.$set, 'legacy transitions must actually update durable state');
          assert.equal(update.$setOnInsert, undefined);
          assert.equal(options.writeConcern.w, 'majority');
          assert.deepEqual(filter.$expr.$eq[1].$literal, stored, 'Transition must fence the complete durable preimage');
          for (const [key, value] of Object.entries(update.$set)) {
            if (key.startsWith('meta.')) { stored.meta ??= {}; stored.meta[key.slice(5)] = structuredClone(value); }
            else stored[key] = structuredClone(value);
          }
          for (const key of Object.keys(update.$unset ?? {})) delete stored[key];
          return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
        }
      });
      persistence.fireAndForget = () => assert.fail('Legacy MAX transitions must be awaited');
      const service = new SupportService(persistence, {} as any, {} as any) as any;
      service.outbox.set(seed.id, seed);
      const controller = new SupportController(service);
      const pulled = await controller.pullOutbox(undefined, connector);
      assert.equal(persistence.legacyMaxCustodyDiagnostics().pendingWrites, 0);
      assert.equal(pulled.commands[0].status, Status.LEASED);
      assert.equal(stored.status, Status.LEASED);
      assert.throws(() => service.pullOutbox(connector, 1, 30, 'max-lease-v1'), /Conflict/);
      await assert.rejects(() => controller.ackOutbox(undefined, seed.id, { leaseToken: 'synthetic-token' }), /Conflict/);
      await assert.rejects(() => service.failOutbox(seed.id, undefined, true, { failure: { status: 429 } }), /Conflict/);
      await controller.ackOutbox(undefined, seed.id, {});
      assert.equal(persistence.legacyMaxCustodyDiagnostics().pendingWrites, 0);
      assert.equal(stored.status, Status.SENT);
      // A separate process hydrates the persisted terminal state; no lease-expiry replay.
      const restarted = new SupportService(persistence, {} as any, {} as any) as any;
      restarted.outbox.set(seed.id, structuredClone(stored));
      assert.deepEqual(await restarted.pullOutbox(connector), []);
      assert.throws(() => persistence.pullMaxOutbox(connector, 1, 30), /Conflict/);
    }
    let writes = 0;
    const communities = new CommunitiesService({} as any, {
      isEnabled: () => true,
      updateCommunity: async (_id: string, mutation: unknown) => { writes++; return mutation; }
    } as any, {} as any);
    const user = { id: 'synthetic-admin', roles: [Role.SUPER_ADMIN], stationIds: [] } as any;
    await assert.rejects(() => communities.update('synthetic', { communityType: 'EVENT' } as any, user),
      (error: any) => error.getStatus() === 503 && error.getResponse().code === 'COMMUNITY_POLICY_ACTIVATION_DISABLED');
    assert.equal(writes, 0);
    await communities.update('synthetic', { name: 'Synthetic ordinary edit' }, user);
    assert.equal(writes, 1);
    console.log('Release capabilities: strict defaults, legacy persistence/restart, downgrade denial, community activation guard PASS');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
