import * as assert from 'node:assert/strict';
import { communityPolicyTypes, releaseCapabilities } from '../src/common/release-capabilities';
import { CommunitiesService } from '../src/communities/communities.service';
import { Role } from '../src/common/rbac/role.enum';
async function main() {
  assert.deepEqual(communityPolicyTypes({}), []);
  assert.deepEqual(communityPolicyTypes({ PHAB_COMMUNITY_POLICY_TYPES_ENABLED: 'STATION, LEAGUE' }), ['STATION','LEAGUE']);
  for (const value of ['STATION,,LEAGUE','STATION,STATION','station','FRIENDS','UNKNOWN']) {
    assert.throws(() => releaseCapabilities({ PHAB_COMMUNITY_POLICY_TYPES_ENABLED: value }), /INVALID/);
  }
  const before = { ...process.env };
  let writes = 0;
  let current: any = { id: 'synthetic', communityType: 'FRIENDS', stationId: 'station-a' };
  const persistence = { isEnabled: () => true, findCommunityById: async () => current,
    updateCommunity: async (_id: string, mutation: unknown) => { writes++; return { ...current, ...mutation as any }; } };
  const service = new CommunitiesService({} as any, persistence as any);
  const admin: any = { id: 'synthetic-admin', roles: [Role.SUPER_ADMIN], stationIds: [] };
  const request = (type: any) => ({ communityType: type, typeSettings: {}, expectedTypeSettingsRevision: 0 });
  try {
    process.env.PHAB_COMMUNITY_POLICIES_ENABLED = 'true';
    process.env.PHAB_COMMUNITY_POLICY_TYPES_ENABLED = 'STATION,LEAGUE';
    for (const type of ['STATION','LEAGUE']) await service.update('synthetic', request(type), admin);
    assert.equal(writes, 2);
    for (const type of ['CORPORATE','EVENT']) {
      await assert.rejects(() => service.update('synthetic', request(type), admin), (error: any) => error.getResponse().code === 'COMMUNITY_POLICY_TYPE_DISABLED');
    }
    assert.equal(writes, 2);
    current = { ...current, communityType: 'CORPORATE' };
    await assert.rejects(() => service.update('synthetic', { typeSettings: {} }, admin), /Service Unavailable/);
    await assert.rejects(() => service.update('synthetic', request('STATION'), admin), /Service Unavailable/);
    assert.equal(writes, 2);
    process.env.PHAB_COMMUNITY_POLICIES_ENABLED = 'false';
    await service.update('synthetic', request('FRIENDS'), admin);
    assert.equal(writes, 3, 'FRIENDS recovery remains available with typed activation OFF');
    await assert.rejects(() => service.update('synthetic', request('FRIENDS'), { ...admin, roles: [Role.SUPPORT] }), /ACCESS_DENIED/);
    await assert.rejects(() => service.update('synthetic', request('FRIENDS'), { ...admin, roles: [Role.MANAGER], stationIds: ['other'] }), /ACCESS_DENIED/);
    assert.equal(writes, 3, 'Recovery does not grant roles or station access');
    current = { ...current, communityType: 'FRIENDS' };
    await service.update('synthetic', { name: 'Ordinary edit' }, admin);
    assert.equal(writes, 4);
    console.log('Community activation allowlist, blocked edits, FRIENDS recovery, role/station guards PASS');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
