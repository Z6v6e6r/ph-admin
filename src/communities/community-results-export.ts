import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { buildCommunityRatingSnapshot, CommunityRatingSnapshot } from './canonical-rating/aggregates';
import { COMMUNITY_RATING_CALCULATION_VERSION } from './canonical-rating/contract';
import { CommunityRatingFact, CommunityRatingMemberSeed } from './canonical-rating/facts';

const DAY_MS = 86400000;
const MOSCOW_OFFSET_MS = 3 * 3600000;
export interface CommunityResultsWindow {
  period: 'all' | 'month' | 'week' | 'custom';
  from?: string;
  to?: string;
  places: number;
  startTs: number | null;
  endExclusiveTs: number;
  nowTs: number;
}

function parseDate(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('RESULTS_EXPORT_INVALID_DATE');
  }
  const ts = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(ts) || new Date(ts).toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('RESULTS_EXPORT_INVALID_DATE');
  }
  return ts - MOSCOW_OFFSET_MS;
}

export function resolveCommunityResultsWindow(query: Record<string, unknown>, nowTs = Date.now()): CommunityResultsWindow {
  const period = query.period ?? 'month';
  if (period !== 'month' && period !== 'week' && period !== 'all' && period !== 'custom') {
    throw new BadRequestException('RESULTS_EXPORT_INVALID_PERIOD');
  }
  const places = query.places === undefined ? 10 : Number(query.places);
  if ((typeof query.places !== 'string' && query.places !== undefined && typeof query.places !== 'number') ||
      !Number.isInteger(places) || places < 1 || places > 50) {
    throw new BadRequestException('RESULTS_EXPORT_INVALID_PLACES');
  }
  if (period !== 'custom' && (query.from !== undefined || query.to !== undefined)) {
    throw new BadRequestException('RESULTS_EXPORT_UNEXPECTED_DATES');
  }
  const moscow = new Date(nowTs + MOSCOW_OFFSET_MS);
  let startTs: number | null = null;
  let endExclusiveTs = nowTs + 1;
  if (period === 'month') {
    startTs = Date.UTC(moscow.getUTCFullYear(), moscow.getUTCMonth(), 1) - MOSCOW_OFFSET_MS;
  } else if (period === 'week') {
    startTs = Date.UTC(moscow.getUTCFullYear(), moscow.getUTCMonth(), moscow.getUTCDate())
      - MOSCOW_OFFSET_MS - ((moscow.getUTCDay() + 6) % 7) * DAY_MS;
  } else if (period === 'custom') {
    startTs = parseDate(query.from);
    endExclusiveTs = parseDate(query.to) + DAY_MS;
    if (startTs >= endExclusiveTs) throw new BadRequestException('RESULTS_EXPORT_INVALID_RANGE');
  }
  return { period, places, startTs, endExclusiveTs, nowTs,
    ...(period === 'custom' ? {from: query.from as string, to: query.to as string} : {}) };
}

export interface CommunityResultsExportSource {
  snapshot: CommunityRatingSnapshot;
  facts: CommunityRatingFact[];
}

export function buildCommunityResultsExport(communityId: string, source: CommunityResultsExportSource, window: CommunityResultsWindow) {
  const {snapshot, facts} = source;
  const unavailable = () => new ServiceUnavailableException('RESULTS_EXPORT_RATING_NOT_READY');
  if (!snapshot || snapshot.communityId !== communityId || snapshot.period !== 'all' || snapshot.tab !== 'overall' ||
      snapshot.calculationVersion !== COMMUNITY_RATING_CALCULATION_VERSION || !Array.isArray(snapshot.rows) ||
      !Number.isFinite(snapshot.updatedAtTs) || snapshot.updatedAtTs > window.nowTs ||
      Date.parse(snapshot.updatedAt) !== snapshot.updatedAtTs || !Array.isArray(facts)) throw unavailable();
  // A worker replaces facts before publishing snapshots. Pin the generation and
  // replay the all-time snapshot to refuse empty/partial/interleaved worker reads.
  if (facts.length !== snapshot.rows.reduce((count, row) => count + row.totalEventsPlayed, 0) ||
      facts.some(fact => fact.communityId !== communityId || fact.collectedAt !== snapshot.updatedAt ||
        fact.calculationVersion !== COMMUNITY_RATING_CALCULATION_VERSION) ||
      new Set(facts.map(fact => fact.id)).size !== facts.length) throw unavailable();
  const members: CommunityRatingMemberSeed[] = snapshot.rows.map(row => ({
    playerKey: row.playerKey, playerId: row.playerId, playerPhone: row.playerPhone,
    playerName: row.playerName, playerAvatarUrl: row.avatarUrl, currentLevel: row.currentLevel
  }));
  const replay = buildCommunityRatingSnapshot({
    communityId, facts, members, period: 'all', tab: 'overall', nowTs: snapshot.updatedAtTs, updatedAt: snapshot.updatedAt
  });
  if (!isDeepStrictEqual(replay.rows, snapshot.rows)) throw unavailable();
  // Only select events here; the pinned canonical engine owns all formulas,
  // population normalization and tie-breaks. Never persist arbitrary periods.
  const selected = facts.filter(fact => {
    const eventTs = fact.eventType === 'tournament' && window.period !== 'all'
      ? fact.eventStartedAtTs ?? fact.occurredAtTs : fact.occurredAtTs;
    return fact.occurredAtTs <= snapshot.updatedAtTs && eventTs <= snapshot.updatedAtTs &&
      (window.startTs === null || eventTs >= window.startTs) && eventTs < window.endExclusiveTs;
  });
  const rows = selected.length === 0 ? [] : buildCommunityRatingSnapshot({
    communityId, facts: selected, members, period: 'all', tab: 'overall', nowTs: snapshot.updatedAtTs,
    updatedAt: snapshot.updatedAt
  }).rows;
  return {
    communityId, period: window.period, ...(window.period === 'custom' ? {from: window.from, to: window.to} : {}),
    timeZone: 'Europe/Moscow', calculationVersion: COMMUNITY_RATING_CALCULATION_VERSION,
    dataAsOf: snapshot.updatedAt, rangeFrom: window.startTs === null ? null : new Date(window.startTs).toISOString(),
    rangeToExclusive: new Date(window.endExclusiveTs).toISOString(),
    rows: rows.slice(0, window.places).map(row => {
      const name = String(row.playerName).trim();
      const identifiers = [row.playerId, row.playerPhone, row.playerKey, row.playerKey.replace(/^(id|phone):/, '')];
      const isIdentifier = identifiers.some(value => value && name === value);
      // Legacy display names can fall back to phone or an internal ID. Redact
      // only presentation; never change canonical ordering or scores.
      return {rank: row.rank, name: isIdentifier || name.replace(/\D/g, '').length >= 10 ? 'Игрок ' + row.rank : name, score: row.overallScore};
    })
  };
}
