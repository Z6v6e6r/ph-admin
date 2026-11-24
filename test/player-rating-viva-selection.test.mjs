import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const sdk = readFileSync(new URL('../client-sdk/phab-admin-panel.js', import.meta.url), 'utf8');
const feature = sdk.slice(
  sdk.indexOf('    function isCurrentPlayerRatingCandidateSearch(query)'),
  sdk.indexOf('    async function loadPlayerRatingEvents(append)')
);
const candidate = { clientId: 'synthetic-player', name: 'Анна Тест' };
const current = { playerKey: 'client:canonical-player', ratingNumeric: 3.72125 };

function setup(getPlayerRating, loadPlayerRatingEvents = async () => {}) {
  const opened = [];
  const state = { activeTab: 'playerRatings', selectedPlayerRatingKey: null, selectedPlayerRating: null };
  const trigger = { disabled: false, isConnected: true };
  const modalClasses = new Set(['phab-admin-hidden']);
  const dom = {
    playerRatingsSearchInput: { value: candidate.name }, playerRatingsSearchState: {}, playerRatingDetail: {},
    playerRatingEditModal: { classList: { contains: value => modalClasses.has(value) } }
  };
  const open = runInNewContext(feature + '\nopenVivaPlayerRatingCandidate', {
    state, dom, api: { getPlayerRating },
    renderPlayerRatingsList() {},
    renderPlayerRatingDetail() {},
    loadPlayerRatingEvents,
    openPlayerRatingEdit: () => opened.push(state.selectedPlayerRating)
  });
  return { state, dom, trigger, opened, modalClasses, choose: () => open(candidate, trigger, candidate.name) };
}

test('Viva selection shows the current canonical card and loads its history', async () => {
  const reads = [];
  let historyReads = 0;
  const flow = setup(async key => { reads.push(key); return current; }, async () => { historyReads++; });
  await flow.choose();
  assert.deepEqual(reads, ['client:synthetic-player']);
  assert.equal(flow.state.selectedPlayerRating, current);
  assert.equal(flow.state.selectedPlayerRatingKey, current.playerKey);
  assert.equal(flow.opened.length, 0);
  assert.equal(historyReads, 1);
});

test('Only the card lookup 404 opens first assignment', async () => {
  const missing = setup(async () => { throw { status: 404, code: 'PLAYER_RATING_STATE_NOT_FOUND' }; });
  await missing.choose();
  assert.equal(missing.opened[0].initialAssignment, true);
  const legacyMissing = setup(async () => { throw { status: 404, payload: { message: 'Player rating state not found' } }; });
  await legacyMissing.choose();
  assert.equal(legacyMissing.opened[0].initialAssignment, true);
  for (const status of [403, 404, 409, 503]) {
    const failed = setup(async () => { throw { status, message: 'Unavailable' }; });
    await failed.choose();
    assert.equal(failed.opened.length, 0);
    assert.match(failed.dom.playerRatingsSearchState.textContent, /Не удалось проверить/);
  }
  const historyUnavailable = setup(async () => current, async () => { throw { status: 404 }; });
  await assert.rejects(historyUnavailable.choose(), error => error.status === 404);
  assert.equal(historyUnavailable.state.selectedPlayerRating, current);
  assert.equal(historyUnavailable.opened.length, 0);
});

test('A stale Viva response does not open a card after the query changes', async () => {
  let complete;
  const flow = setup(() => new Promise(resolve => { complete = resolve; }));
  const pending = flow.choose();
  assert.equal(flow.trigger.disabled, true);
  flow.dom.playerRatingsSearchInput.value = 'Другое имя';
  complete(current);
  await pending;
  assert.equal(flow.state.selectedPlayerRating, null);
  assert.equal(flow.opened.length, 0);
  assert.equal(flow.trigger.disabled, false);
});

test('A delayed Viva response cannot switch players while the previous card is being edited', async () => {
  let complete;
  const flow = setup(() => new Promise(resolve => { complete = resolve; }));
  const previous = { playerKey: 'client:previous', ratingNumeric: 2.5 };
  flow.state.selectedPlayerRating = previous;
  flow.state.selectedPlayerRatingKey = previous.playerKey;
  const pending = flow.choose();
  flow.modalClasses.delete('phab-admin-hidden');
  complete(current);
  await pending;
  assert.equal(flow.state.selectedPlayerRating, previous);
  assert.equal(flow.state.selectedPlayerRatingKey, previous.playerKey);
});
