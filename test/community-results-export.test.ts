import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { buildCommunityResultsExport, resolveCommunityResultsWindow } from '../src/communities/community-results-export';
import { buildCommunityRatingSnapshot } from '../src/communities/canonical-rating/aggregates';
import { COMMUNITY_RATING_CALCULATION_VERSION } from '../src/communities/canonical-rating/contract';
import { CommunityRatingFact, CommunityRatingMemberSeed } from '../src/communities/canonical-rating/facts';

const now = Date.parse('2026-10-15T10:00:00Z');
assert.equal(new Date(resolveCommunityResultsWindow({period: 'week'}, now).startTs!).toISOString(), '2026-10-11T21:00:00.000Z');
assert.equal(new Date(resolveCommunityResultsWindow({period: 'month'}, now).startTs!).toISOString(), '2026-09-30T21:00:00.000Z');
assert.equal(new Date(resolveCommunityResultsWindow({period: 'week'}, Date.parse('2027-01-01T12:00:00Z')).startTs!).toISOString(), '2026-12-27T21:00:00.000Z');
const day = resolveCommunityResultsWindow({period: 'custom', from: '2026-10-01', to: '2026-10-01'}, now);
assert.equal(new Date(day.startTs!).toISOString(), '2026-09-30T21:00:00.000Z');
assert.equal(new Date(day.endExclusiveTs).toISOString(), '2026-10-01T21:00:00.000Z');
for (const query of [
  {period:'bad'}, {period:'custom',from:'2026-02-30',to:'2026-03-01'},
  {period:'custom',from:'2026-10-15',to:'2026-10-01'}, {period:'custom'},
  {period:['all']}, {period:'all',from:'2026-10-01'}, {period:'all',places:'51'}
]) assert.throws(() => resolveCommunityResultsWindow(query, now));
console.log('Community results period tests passed');

const members: CommunityRatingMemberSeed[] = ['Анна', 'Борис', 'Вера'].map((name, i) => ({
  playerKey: 'id:synthetic-' + i, playerId: 'synthetic-' + i, playerPhone: null,
  playerName: name, playerAvatarUrl: null, currentLevel: 2
}));
function visit(id: string, player: number, at: string): CommunityRatingFact {
  return {
    id, communityId: 'synthetic-community', sourcePostId: null, eventId: id,
    ...members[player], playerAvatarUrl: null, ratingDelta: 0, ratingEventIds: [],
    lastRatingDelta: null, lastRatingChangedAt: null, lastRatingChangedAtTs: null, lastRatingEventId: null,
    occurredAt: at, occurredAtTs: Date.parse(at), calculationVersion: COMMUNITY_RATING_CALCULATION_VERSION,
    collectedAt: new Date(now).toISOString(), eventType: 'visit', metrics: { visitsAttended: 1 }
  };
}
const facts = [
  visit('old', 0, '2026-09-20T08:00:00Z'), visit('sunday', 0, '2026-10-11T20:59:59Z'),
  visit('monday', 1, '2026-10-11T21:00:00Z'), visit('last', 1, '2026-10-14T20:59:59Z'),
  visit('excluded-end', 2, '2026-10-14T21:00:00Z')
];
const snapshot = buildCommunityRatingSnapshot({communityId:'synthetic-community', period:'all', facts, members, nowTs:now});
const source = {snapshot, facts};
const all = buildCommunityResultsExport('synthetic-community', source, resolveCommunityResultsWindow({period:'all'}, now));
assert.deepEqual(all.rows.map(r => r.score), snapshot.rows.map(r => r.overallScore));
assert.ok(all.rows.every(row => Object.keys(row).sort().join(',') === 'name,rank,score'));
assert.doesNotMatch(JSON.stringify(all), /playerKey|playerPhone|synthetic-0/);
const week = buildCommunityResultsExport('synthetic-community', source, resolveCommunityResultsWindow({period:'week'}, now));
assert.equal(week.rows[0].name, 'Борис');
const custom = buildCommunityResultsExport('synthetic-community', source, resolveCommunityResultsWindow({period:'custom',from:'2026-10-12',to:'2026-10-14'}, now));
assert.equal(custom.rows[0].name, 'Борис');
assert.equal(custom.rows.find(row => row.name === 'Вера')?.score, 0);
assert.deepEqual(buildCommunityResultsExport('synthetic-community', source, resolveCommunityResultsWindow({period:'week',places:'1'}, now)).rows, week.rows.slice(0,1));
for (const broken of [
  {snapshot, facts: []}, {snapshot, facts: facts.slice(1)},
  {snapshot: {...snapshot, calculationVersion:'other'}, facts},
  {snapshot, facts: facts.map(f => ({...f, collectedAt:'2026-10-15T09:00:00Z'}))}
]) assert.throws(() => buildCommunityResultsExport('synthetic-community', broken, resolveCommunityResultsWindow({period:'week'}, now)));
assert.equal(buildCommunityResultsExport('synthetic-community', source, resolveCommunityResultsWindow({period:'custom',from:'2026-01-01',to:'2026-01-01'}, now)).rows.length, 0);
console.log('Community results canonical generation, window and privacy tests passed');

const tournaments: CommunityRatingFact[] = [
  {...visit('inside-start',0,'2026-10-15T09:00:00Z'), eventType:'tournament', eventStartedAtTs:Date.parse('2026-10-12T08:00:00Z'), metrics:{tournamentsPlayed:1,participantsCount:4,place:1,placeScore:100,placeBonus:30,tournamentMatchesWon:3,tournamentPointsScored:20,tournamentPointsAgainst:5,tournamentPointsDiff:15,tournamentRawScore:179}},
  {...visit('outside-start',1,'2026-10-12T09:00:00Z'), eventType:'tournament', eventStartedAtTs:Date.parse('2026-10-11T20:59:59Z'), metrics:{tournamentsPlayed:1,participantsCount:4,place:1,placeScore:100,placeBonus:30,tournamentMatchesWon:3,tournamentPointsScored:20,tournamentPointsAgainst:5,tournamentPointsDiff:15,tournamentRawScore:179}}
];
const tournamentSnapshot = buildCommunityRatingSnapshot({communityId:'synthetic-community',period:'all',members,facts:tournaments,nowTs:now});
const tournamentSource={snapshot:tournamentSnapshot,facts:tournaments};
const tournamentWeek=buildCommunityResultsExport('synthetic-community',tournamentSource,resolveCommunityResultsWindow({period:'week'},now));
assert.equal(tournamentWeek.rows[0].name,'Анна');
assert.equal(tournamentWeek.rows.find(row=>row.name==='Борис')?.score,0);
const closingAfterRange=buildCommunityResultsExport('synthetic-community',tournamentSource,resolveCommunityResultsWindow({period:'custom',from:'2026-10-12',to:'2026-10-12'},now));
assert.equal(closingAfterRange.rows[0].name,'Анна');
const month = buildCommunityResultsExport('synthetic-community',source,resolveCommunityResultsWindow({period:'month'},now));
const canonicalMonth=buildCommunityRatingSnapshot({communityId:'synthetic-community',members,facts,period:'month',nowTs:now});
assert.deepEqual(month.rows,canonicalMonth.rows.map(row=>({rank:row.rank,name:row.playerName,score:row.overallScore})));
console.log('Community results tournament scheduled-date, late-finalization and month parity tests passed');

const privateMembers = members.map((member,i) => ({...member,playerName:i===0?'+7 (000) 000-00-00':member.playerName}));
const privateFacts = [visit('private-name',0,'2026-10-14T12:00:00Z')].map(f=>({...f,playerName:privateMembers[0].playerName}));
const privateSnapshot=buildCommunityRatingSnapshot({communityId:'synthetic-community',members:privateMembers,facts:privateFacts,period:'all',nowTs:now});
const privateExport=buildCommunityResultsExport('synthetic-community',{snapshot:privateSnapshot,facts:privateFacts},resolveCommunityResultsWindow({period:'all'},now));
assert.doesNotMatch(JSON.stringify(privateExport),/\+7 \(000\)/);
const identifierMembers=members.map((member,i)=>({...member,playerId:i===0?'opaque-private-id':member.playerId,playerName:i===0?'opaque-private-id':member.playerName}));
const identifierFacts=[{...visit('private-id',0,'2026-10-14T12:00:00Z'),playerId:'opaque-private-id',playerName:'opaque-private-id'}];
const identifierSnapshot=buildCommunityRatingSnapshot({communityId:'synthetic-community',members:identifierMembers,facts:identifierFacts,period:'all',nowTs:now});
const identifierExport=buildCommunityResultsExport('synthetic-community',{snapshot:identifierSnapshot,facts:identifierFacts},resolveCommunityResultsWindow({period:'all'},now));
assert.doesNotMatch(JSON.stringify(identifierExport),/opaque-private-id/);
