import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { communityType, parseCommunityTypeSettings, DEFAULT_LEAGUE_DIVISIONS, resolveLeagueDivision } from '../src/communities/community-policy';
import { CommunitiesPersistenceService } from '../src/communities/communities-persistence.service';
import { CommunitiesService } from '../src/communities/communities.service';
import { Role } from '../src/common/rbac/role.enum';

async function main() {
  assert.equal(communityType(undefined), 'FRIENDS');
  assert.equal(communityType('unknown'), 'FRIENDS');
  assert.deepEqual(parseCommunityTypeSettings('FRIENDS', {}), {});
  assert.deepEqual(parseCommunityTypeSettings('STATION', { stationId: 'station-a' }), { stationId: 'station-a' });
  assert.deepEqual(parseCommunityTypeSettings('CORPORATE', { directionIds: ['6180', '6180'], vivaSubscriptionId: 'synthetic-subscription' }),
    { directionIds: ['6180'], exerciseTypeIds: [], categories: [], vivaSubscriptionId: 'synthetic-subscription' });
  assert.ok(parseCommunityTypeSettings('CORPORATE', { categories: ['group_training'] }));
  const settings = parseCommunityTypeSettings('LEAGUE', { divisions: DEFAULT_LEAGUE_DIVISIONS });
  assert.equal(resolveLeagueDivision(settings.divisions!, 2)?.id, 'd-plus-c');
  assert.equal(resolveLeagueDivision(settings.divisions!, 3)?.id, 'c-c-plus');
  assert.equal(resolveLeagueDivision(settings.divisions!, 3.5)?.id, 'c-c-plus');
  assert.equal(resolveLeagueDivision(settings.divisions!, 3.51), null);
  assert.equal(resolveLeagueDivision(settings.divisions!, null), null);
  for (const [type, value] of [
    ['STATION', {}], ['STATION', { stationId: '$bad' }], ['CORPORATE', {}],
    ['CORPORATE', { categories: ['unknown'] }], ['FRIENDS', { stationId: 'station-a' }],
    ['LEAGUE', { divisions: [{ id: 'x', name: 'X', minLevel: 2, maxLevel: 2 }] }],
    ['LEAGUE', { divisions: [{ id: 'a', name: 'A', minLevel: 1, maxLevel: 3 }, { id: 'b', name: 'B', minLevel: 2, maxLevel: 4 }] }],
    ['LEAGUE', { divisions: [{ id: 'a', name: 'A', minLevel: 1, maxLevel: 2 }, { id: 'a', name: 'B', minLevel: 2, maxLevel: 4 }] }],
    ['LEAGUE', { divisions: [{ id: 'a', name: 'A', minLevel: '1', maxLevel: 2 }] }], ['bad', {}], ['FRIENDS', null],
  ] as Array<[unknown, unknown]>) assert.throws(() => parseCommunityTypeSettings(type, value));

  const persistence = new CommunitiesPersistenceService() as any;
  let document: any = { id: 'community-a', name: 'Тест', stationId: 'station-a', members: [{ id: 'member-a', name: 'Участник' }], pendingMembers: [], bannedMembers: [] };
  let writes = 0; let conflict = false; const payloads: any[] = [];
  const collection = { async updateOne(filter: any, mutation: any) {
    writes++; payloads.push({ filter, mutation });
    assert.equal(mutation.$set.members, undefined, 'settings must never overwrite concurrent members');
    if (conflict) return { matchedCount: 0 };
    Object.assign(document, mutation.$set); return { matchedCount: 1 };
  } };
  persistence.findDocumentWithSourceById = async () => ({ document: structuredClone(document), collection });
  persistence.findCommunityById = async () => persistence.toCommunity(document);
  assert.equal((await persistence.findCommunityById('community-a')).communityType, 'FRIENDS');
  assert.equal(document.communityType, undefined, 'legacy reads have no migration side effects');
  await assert.rejects(() => persistence.updateCommunity('community-a', { communityType: 'STATION', typeSettings: { stationId: 'station-a' } }), /REVISION_CONFLICT/);
  assert.equal(writes, 0);
  await persistence.updateCommunity('community-a', { communityType: 'STATION', typeSettings: { stationId: 'station-a' }, expectedTypeSettingsRevision: 0 });
  assert.equal(document.typeSettingsRevision, 1);
  assert.equal(document.members.length, 1);
  assert.ok(payloads[0].filter.$and);
  const activated = document.typeSettingsEffectiveAt;
  await persistence.updateCommunity('community-a', { typeSettings: { stationId: 'station-b' }, expectedTypeSettingsRevision: 1 });
  assert.equal(document.typeSettingsRevision, 2);
  assert.equal(document.typeSettingsEffectiveAt, activated);
  conflict = true;
  await assert.rejects(() => persistence.updateCommunity('community-a', { communityType: 'FRIENDS', typeSettings: {}, expectedTypeSettingsRevision: 2 }), /REVISION_CONFLICT/);
  conflict = false;

  persistence.isEnabled = () => true;
  const service = new CommunitiesService({} as any, persistence);
  const request = { communityType: 'FRIENDS' as const, typeSettings: {}, expectedTypeSettingsRevision: 2 };
  const user: any = { id: 'synthetic-admin', roles: [Role.SUPPORT], stationIds: [] };
  await assert.rejects(() => service.update('community-a', request, user), /ACCESS_DENIED/);
  await assert.rejects(() => service.update('community-a', request), /ACCESS_DENIED/);
  await assert.rejects(() => service.update('community-a', request, { ...user, roles: [Role.MANAGER], stationIds: ['station-other'] }), /ACCESS_DENIED/);
  await assert.rejects(() => service.update('community-a', request, { ...user, roles: [Role.MANAGER], permissions: [] }), /ACCESS_DENIED/);
  await assert.rejects(() => service.update('community-a', request, { ...user, roles: [Role.MANAGER], permissions: ['settings:write'], permissionStationScopes: { 'settings:write': [] } }), /ACCESS_DENIED/);
  await service.update('community-a', request, { ...user, roles: [Role.SUPER_ADMIN] });
  assert.equal(document.communityType, 'FRIENDS');
  assert.equal(document.members[0].id, 'member-a');
  let memberWrite: any;
  await persistence.persistDocument({ ...document, members: [], communityType: 'STALE', leagueAssignmentOutbox: [] }, { async updateOne(filter: any, update: any) { memberWrite = { filter, update }; return { matchedCount: 1 }; } }, document);
  assert.equal(memberWrite.update.$set.communityType, undefined);
  assert.equal(memberWrite.update.$set.leagueAssignmentOutbox, undefined);
  assert.ok(memberWrite.filter.$and[1].members);
  await assert.rejects(() => persistence.persistDocument(document, { async updateOne() { return { matchedCount: 0 }; } }, document), /MEMBERS_CHANGED/);
  console.log('Community types: defaults, strict config, division boundaries, scoped authorization and CAS preservation passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
