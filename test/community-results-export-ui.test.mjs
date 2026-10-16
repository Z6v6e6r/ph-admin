import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../client-sdk/phab-admin-panel.js', import.meta.url), 'utf8');
function helpers() {
  const start = source.indexOf('  function communityResultsExportOptions(');
  const end = source.indexOf('  function createApi(', start);
  assert.ok(start >= 0, 'community results export helpers must exist');
  const context = vm.createContext({ window: {}, Date, URLSearchParams, Number, Error });
  vm.runInContext(source.slice(start, end), context);
  return context;
}

test('export options preserve each requested period and strict inclusive custom dates', () => {
  const api = helpers();
  for (const period of ['month', 'week', 'all']) {
    assert.equal(api.communityResultsExportOptions(period, '', '', '10').period, period);
  }
  const range = api.communityResultsExportOptions('custom', '2026-10-01', '2026-10-15', '3');
  assert.equal(range.from, '2026-10-01');
  assert.equal(range.to, '2026-10-15');
  assert.equal(range.places, 3);
  for (const args of [
    ['custom', '', '', '3'], ['custom', '2026-02-30', '2026-03-01', '3'],
    ['custom', '2026-10-15', '2026-10-01', '3'], ['unknown', '', '', '3'],
    ['all', '', '', '0'], ['all', '', '', '51'], ['all', '', '', '2.5']
  ]) assert.throws(() => api.communityResultsExportOptions(...args));
});

test('export rejects mismatched or unavailable snapshots instead of relabelling all-time results', () => {
  const api = helpers();
  const options = api.communityResultsExportOptions('week', '', '', '3');
  const payload = { communityId: 'test-community', period: 'week', dataAsOf: '2026-10-15T10:00:00.000Z', rows: [
    { name: 'Первый', rank: 1, score: 42, phone: 'private' },
    { name: 'Второй', rank: 2, score: 15 }
  ] };
  const rows = api.communityResultsExportRows(payload, 'test-community', options);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].score, 42);
  assert.equal(rows[0].phone, undefined);
  for (const patch of [{period: 'all'}, {communityId: 'other'}, {degraded: true}, {rows: null}, {dataAsOf: 'invalid'}, {rows:[{name:'Имя',rank:0,score:null}]}]) {
    assert.throws(() => api.communityResultsExportRows({...payload, ...patch}, 'test-community', options));
  }
  const range = api.communityResultsExportOptions('custom', '2026-10-01', '2026-10-15', '3');
  assert.throws(() => api.communityResultsExportRows({...payload, period: 'custom'}, 'test-community', range));
  assert.equal(api.communityResultsExportRows({...payload, period: 'custom', from: range.from, to: range.to}, 'test-community', range).length, 2);
  assert.equal(api.communityResultsExportRows({...payload, rows: []}, 'test-community', options).length, 0);
});

test('community header opens the results dialog and forwards period boundaries', () => {
  assert.match(source, /function openCommunityResultsExport\(community\)/);
  assert.match(source, /'Выгрузить результаты',[\s\S]{0,160}openCommunityResultsExport\(community\)/);
  assert.match(source, /function createCommunityResultsExportDialog\(/);
  for (const field of ['period', 'places', 'from', 'to']) {
    const rankingApi = source.slice(source.indexOf('exportCommunityResults: function'), source.indexOf('updateCommunity: function'));
    assert.match(rankingApi, new RegExp("params.set\\('" + field + "'"));
  }
  const open = source.slice(source.indexOf('function openCommunityResultsExport('), source.indexOf('function getSelectedCommunity('));
  assert.doesNotMatch(open, /resolveCommunityAccessIdentity|phone|clientId/);
});

test('canonical engine files retain their explicit upstream pin', () => {
  const root = new URL('../src/communities/canonical-rating/', import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', root), 'utf8'));
  assert.equal(provenance.repository, 'Z6v6e6r/lk');
  for (const [name, info] of Object.entries(provenance.files)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(name, root))).digest('hex'), info.localSha256, name);
  }
});

test('template requests allow only validated optional statistics and preserve the old row shape',()=>{
  const api=helpers();
  const payload={communityId:'fixture',period:'all',dataAsOf:'2026-10-16T10:00:00Z',rows:[{rank:1,name:'Игрок',score:42,statistics:{tournamentsPlayed:4,tournamentsWon:1,playerId:'private'}}]};
  const options={period:'all',places:10,details:'templates-v1'};
  const rows=api.communityResultsExportRows(payload,'fixture',options);
  assert.equal(rows[0].statistics.tournamentsPlayed,4);
  assert.equal(rows[0].statistics.tournamentsWon,1);
  assert.equal(rows[0].statistics.playerId,undefined);
  assert.equal(api.communityResultsExportRows(payload,'fixture',{period:'all',places:10})[0].statistics,undefined);
  for(const statistics of [{tournamentsPlayed:-1,tournamentsWon:0},{tournamentsPlayed:1,tournamentsWon:'1'},{tournamentsPlayed:1,tournamentsWon:2}]) {
    assert.throws(()=>api.communityResultsExportRows({...payload,rows:[{...payload.rows[0],statistics}]},'fixture',options));
  }
});
