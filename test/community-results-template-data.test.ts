import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { buildCommunityResultsExport, resolveCommunityResultsWindow } from '../src/communities/community-results-export';
import { buildCommunityRatingSnapshot } from '../src/communities/canonical-rating/aggregates';
import { COMMUNITY_RATING_CALCULATION_VERSION } from '../src/communities/canonical-rating/contract';
import { CommunityRatingFact } from '../src/communities/canonical-rating/facts';

const now = Date.parse('2026-10-16T10:00:00Z');
const member = {playerKey:'id:fixture-player',playerId:'fixture-player',playerPhone:null,playerName:'Тестовый игрок',playerAvatarUrl:null,currentLevel:2};
function tournament(id: string, date: string, place: number): CommunityRatingFact {
  return {...member,id,communityId:'fixture-community',sourcePostId:null,eventId:id,ratingDelta:0,ratingEventIds:[],
    lastRatingDelta:null,lastRatingChangedAt:null,lastRatingChangedAtTs:null,lastRatingEventId:null,
    occurredAt:date,occurredAtTs:Date.parse(date),eventStartedAtTs:Date.parse(date),collectedAt:new Date(now).toISOString(),
    calculationVersion:COMMUNITY_RATING_CALCULATION_VERSION,eventType:'tournament',
    metrics:{tournamentsPlayed:1,participantsCount:8,place,placeScore:100,placeBonus:0,tournamentMatchesWon:10,
      tournamentPointsScored:30,tournamentPointsAgainst:10,tournamentPointsDiff:20,tournamentRawScore:120}};
}
const facts = [tournament('old','2026-09-20T10:00:00Z',1),tournament('first','2026-10-12T10:00:00Z',1),tournament('second','2026-10-14T10:00:00Z',2)];
function source(input = facts) {
  return {facts:input,snapshot:buildCommunityRatingSnapshot({communityId:'fixture-community',facts:input,members:[member],period:'all',nowTs:now})};
}
const plain = buildCommunityResultsExport('fixture-community',source(),resolveCommunityResultsWindow({period:'month'},now));
assert.deepEqual(Object.keys(plain.rows[0]).sort(),['name','rank','score'],'old consumers retain the exact allowlist');
const detailed = buildCommunityResultsExport('fixture-community',source(),resolveCommunityResultsWindow({period:'month',details:'templates-v1'},now));
assert.deepEqual((detailed.rows[0] as any).statistics,{tournamentsPlayed:2,tournamentsWon:1},'wins mean first-place tournament finishes, not match wins; use the selected period');
assert.equal(detailed.rows[0].score,plain.rows[0].score,'presentation statistics cannot change canonical scores');
assert.doesNotMatch(JSON.stringify(detailed),/fixture-player|playerKey|playerPhone|ratingEventIds/);
assert.equal((detailed.rows[0] as any).positionChange,undefined,'never fabricate historical rank movement');
const invalidFacts = [tournament('unknown-place','2026-10-12T10:00:00Z',0)];
const incomplete = buildCommunityResultsExport('fixture-community',source(invalidFacts),resolveCommunityResultsWindow({period:'month',details:'templates-v1'},now));
assert.equal((incomplete.rows[0] as any).statistics.tournamentsWon,null,'an unknown finish must not look like zero wins');
assert.throws(()=>resolveCommunityResultsWindow({details:'arbitrary'},now),/RESULTS_EXPORT_INVALID_DETAILS/);
console.log('Template data: opt-in compatibility, period-scoped tournament wins, unknown values and privacy passed');
