// Same private stored contract as LK scripts/lib/stationMembershipLifetime.mjs.
// No provider call, migration, index creation or public DTO field.
type Row = Record<string, any>;
export interface StationLifetime {
  version: 1;
  revision: number;
  players: Row[];
}
export const stationPlayerId = (row: Row | null | undefined): string | null =>
  [row?.id, row?.clientId, row?.userId, row?.uuid].find(value =>
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) ?? null;
export const stationLifetimeEnabled = (community: Row): boolean => community.communityType === 'STATION' &&
  (process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED === 'true' || community.stationMembershipLifetime !== undefined);
export function stationLifetime(community: Row): StationLifetime {
  const value = community.stationMembershipLifetime;
  if (value === undefined) return { version: 1, revision: 0, players: [] };
  if (!value || Object.keys(value).sort().join(',') !== 'players,revision,version' || value.version !== 1 ||
    !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision >= Number.MAX_SAFE_INTEGER || !Array.isArray(value.players)) throw Error('STATION_LIFETIME_INVALID');
  const seen = new Set<string>();
  for (const row of value.players) {
    if (!row || stationPlayerId({ id: row.playerId }) !== row.playerId || seen.has(row.playerId) ||
      !Number.isSafeInteger(row.epoch) || row.epoch < 0 || row.epoch >= Number.MAX_SAFE_INTEGER ||
      !['ACTIVE', 'LEFT', 'REMOVED', 'BANNED'].includes(row.state) ||
      (row.canonicalUserId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.canonicalUserId))) throw Error('STATION_LIFETIME_INVALID');
    seen.add(row.playerId);
  }
  return value;
}
export function stationLifetimeFence(community: Row): Row {
  const value = stationLifetime(community);
  return community.stationMembershipLifetime === undefined ? { stationMembershipLifetime: { $exists: false } }
    : { 'stationMembershipLifetime.version': 1, 'stationMembershipLifetime.revision': value.revision };
}
export function stationModerationTransition(community: Row, action: string, member: Row): StationLifetime | undefined {
  if (!stationLifetimeEnabled(community)) return community.stationMembershipLifetime;
  const lifetime = stationLifetime(community);
  if (!['REMOVE', 'BAN', 'UNBAN', 'APPROVE'].includes(action)) return community.stationMembershipLifetime;
  const playerId = stationPlayerId(member);
  if (!playerId) throw Error('STATION_MEMBER_ID_REQUIRED');
  const old = lifetime.players.find(row => row.playerId === playerId);
  const state = action === 'REMOVE' ? 'REMOVED' : action === 'BAN' ? 'BANNED' : 'ACTIVE';
  const row = { playerId, ...(old?.canonicalUserId ? { canonicalUserId: old.canonicalUserId } : {}), epoch: (old?.epoch ?? 0) + 1, state };
  return { version: 1, revision: lifetime.revision + 1, players: [...lifetime.players.filter(item => item.playerId !== playerId), row] };
}
