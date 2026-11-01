// Same private stored contract as LK scripts/lib/stationMembershipLifetime.mjs.
// No provider call, migration, index creation or public DTO field.
type Row = Record<string, any>;
export interface StationLifetime {
  version: 1 | 2;
  streamId?: string;
  revision: number;
  players: Row[];
}
export const stationPlayerId = (row: Row | null | undefined): string | null =>
  [row?.id, row?.clientId, row?.userId, row?.uuid].find(value =>
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) ?? null;
export const stationLifetimeEnabled = (community: Row): boolean => community.communityType === 'STATION' &&
  (process.env.LK_STATION_MEMBERSHIP_LIFETIME_ENABLED === 'true' || community.stationMembershipLifetime !== undefined);
const sequence = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < Number.MAX_SAFE_INTEGER;
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function stationStream(community: Row): Row | null {
  const stream = community.communityMessageOutbox;
  if (stream === undefined || Array.isArray(stream)) return null;
  if (!stream || Object.keys(stream).sort().join(',') !== 'acceptedSequence,intents,publishedSequence,revision,streamId,version' ||
    stream.version !== 2 || !uuid(stream.streamId) || !sequence(stream.revision) || !sequence(stream.acceptedSequence) || !sequence(stream.publishedSequence) ||
    stream.publishedSequence > stream.acceptedSequence || !Array.isArray(stream.intents) || stream.intents.length > 32) throw Error('STATION_STREAM_INVALID');
  return stream;
}
export function stationLifetime(community: Row): StationLifetime {
  const value = community.stationMembershipLifetime;
  const stream = stationStream(community);
  if (value === undefined && !stream) return { version: 1, revision: 0, players: [] };
  if (!value || Object.keys(value).sort().join(',') !== (stream ? 'players,revision,streamId,version' : 'players,revision,version') || value.version !== (stream ? 2 : 1) || (stream && value.streamId !== stream.streamId) ||
    !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision >= Number.MAX_SAFE_INTEGER || !Array.isArray(value.players)) throw Error('STATION_LIFETIME_INVALID');
  const seen = new Set<string>();
  for (const row of value.players) {
    if (!row || stationPlayerId({ id: row.playerId }) !== row.playerId || seen.has(row.playerId) ||
      !Number.isSafeInteger(row.epoch) || row.epoch < 0 || row.epoch >= Number.MAX_SAFE_INTEGER ||
      !['ACTIVE', 'LEFT', 'REMOVED', 'BANNED'].includes(row.state) ||
      (row.canonicalUserId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.canonicalUserId))) throw Error('STATION_LIFETIME_INVALID');
    if (stream && row.state === 'ACTIVE') {
      const position = row.readPosition;
      if (!position || Object.keys(position).sort().join(',') !== 'baselineSequence,readThroughSequence,streamId' || position.streamId !== stream.streamId ||
        !sequence(position.baselineSequence) || !sequence(position.readThroughSequence) || position.baselineSequence > position.readThroughSequence || position.readThroughSequence > stream.publishedSequence) throw Error('STATION_READ_POSITION_INVALID');
    }
    seen.add(row.playerId);
  }
  if (stream && (!Array.isArray(community.members) || community.members.some((member: Row) => !stationPlayerId(member) || !value.players.some((player: Row) => player.playerId === stationPlayerId(member) && player.state === 'ACTIVE')))) throw Error('STATION_STREAM_MEMBER_INVALID');
  return value;
}
export function stationLifetimeFence(community: Row): Row {
  const value = stationLifetime(community);
  return community.stationMembershipLifetime === undefined ? { stationMembershipLifetime: { $exists: false } }
    : { 'stationMembershipLifetime.version': value.version, 'stationMembershipLifetime.revision': value.revision, ...(value.version === 2 ? { communityMessageOutbox: community.communityMessageOutbox } : {}) };
}
export function stationModerationTransition(community: Row, action: string, member: Row): StationLifetime | undefined {
  if (!stationLifetimeEnabled(community)) return community.stationMembershipLifetime;
  const lifetime = stationLifetime(community);
  if (!['REMOVE', 'BAN', 'UNBAN', 'APPROVE'].includes(action)) return community.stationMembershipLifetime;
  const playerId = stationPlayerId(member);
  if (!playerId) throw Error('STATION_MEMBER_ID_REQUIRED');
  const old = lifetime.players.find(row => row.playerId === playerId);
  const state = action === 'REMOVE' ? 'REMOVED' : action === 'BAN' ? 'BANNED' : 'ACTIVE';
  if (!sequence((old?.epoch ?? 0) + 1) || !sequence(lifetime.revision + 1)) throw Error('STATION_LIFETIME_OVERFLOW');
  const stream = stationStream(community);
  const row = { ...(stream && state === 'ACTIVE' ? { readPosition: { streamId: stream.streamId, baselineSequence: stream.publishedSequence, readThroughSequence: stream.publishedSequence } } : {}), playerId, ...(old?.canonicalUserId ? { canonicalUserId: old.canonicalUserId } : {}), epoch: (old?.epoch ?? 0) + 1, state };
  return { ...lifetime, revision: lifetime.revision + 1, players: [...lifetime.players.filter(item => item.playerId !== playerId), row] };
}
