import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('client-sdk/phab-tournaments-showcase.js', 'utf8');
const hookMarker = '\n  if (document.readyState === \'loading\') {';
assert.ok(source.includes(hookMarker), 'showcase initialization marker should exist');

const instrumentedSource = source.replace(
  hookMarker,
  `\n  window.__phabTournamentAuthTestHooks = { jsonFetch: jsonFetch, readTournamentReturnTarget: readTournamentReturnTarget, findTournamentReturnItem: findTournamentReturnItem };${hookMarker}`
);

function createHarness({
  href = 'https://padlhub.ru/tournaments',
  cookie = '',
  storedToken = null
} = {}) {
  const requests = [];
  const location = new URL(href);
  const context = {
    URL,
    Date,
    JSON,
    Math,
    Number,
    Object,
    String,
    Array,
    Promise,
    console,
    decodeURIComponent,
    document: {
      cookie,
      currentScript: null,
      readyState: 'loading',
      addEventListener() {}
    },
    window: {
      location,
      localStorage: {
        getItem(key) {
          return key === 'padlhub_auth_token_v1' ? storedToken : null;
        }
      }
    },
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        async json() {
          return { ok: true };
        }
      };
    }
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.fetch = context.fetch;
  vm.runInNewContext(instrumentedSource, context, {
    filename: 'phab-tournaments-showcase.js'
  });
  return {
    jsonFetch: context.window.__phabTournamentAuthTestHooks.jsonFetch,
    readTournamentReturnTarget: context.window.__phabTournamentAuthTestHooks.readTournamentReturnTarget,
    findTournamentReturnItem: context.window.__phabTournamentAuthTestHooks.findTournamentReturnItem,
    requests
  };
}

{
  const harness = createHarness({
    href: 'https://padlhub.ru/tournaments?tournamentId=t-1&date=2026-08-23&slug=weekend-cup'
  });
  const target = harness.readTournamentReturnTarget();
  assert.equal(target.tournamentId, 't-1');
  assert.equal(target.dateKey, '2026-08-23');
  assert.equal(target.slug, 'weekend-cup');
  const item = harness.findTournamentReturnItem({
    items: [{ id: 't-1', slug: 'weekend-cup' }]
  }, target);
  assert.equal(item.id, 't-1');
}

{
  const harness = createHarness({
    storedToken: JSON.stringify({ token: 'lk-access-token', expiresAt: Date.now() + 60_000 })
  });
  await harness.jsonFetch('https://padlhub.su/api/tournaments/public/weekend-cup/join?format=json');
  assert.equal(harness.requests[0].options.headers.Authorization, 'Bearer lk-access-token');
  assert.equal(harness.requests[0].options.credentials, 'omit');
}

{
  const harness = createHarness({
    storedToken: JSON.stringify({ token: 'same-origin-token', expiresAt: Date.now() + 60_000 })
  });
  await harness.jsonFetch('https://padlhub.ru/api/tournaments/public/list');
  assert.equal(harness.requests[0].options.credentials, 'include');
}

{
  const harness = createHarness({
    cookie: 'padlhubAuthToken=cookie-token',
    storedToken: JSON.stringify({ token: 'stored-token', expiresAt: Date.now() + 60_000 })
  });
  await harness.jsonFetch('https://padlhub.su/api/tournaments/public/list');
  assert.equal(harness.requests[0].options.headers.Authorization, 'Bearer cookie-token');
}

{
  const harness = createHarness({
    storedToken: JSON.stringify({ token: 'expired-token', expiresAt: Date.now() - 1 })
  });
  await harness.jsonFetch('https://padlhub.su/api/tournaments/public/list');
  assert.equal(harness.requests[0].options.headers.Authorization, undefined);
}

{
  const harness = createHarness({
    storedToken: JSON.stringify({ token: 'must-not-leak', expiresAt: Date.now() + 60_000 })
  });
  await harness.jsonFetch('https://attacker.example/api/tournaments/public/list');
  assert.equal(harness.requests[0].options.headers.Authorization, undefined);
}

{
  const harness = createHarness({
    storedToken: JSON.stringify({ token: 'must-stay-api-only', expiresAt: Date.now() + 60_000 })
  });
  await harness.jsonFetch('https://padlhub.su/tournaments');
  assert.equal(harness.requests[0].options.headers.Authorization, undefined);
}

{
  const harness = createHarness({
    storedToken: JSON.stringify({ token: 'default-port-only', expiresAt: Date.now() + 60_000 })
  });
  await harness.jsonFetch('https://padlhub.su:8443/api/tournaments/public/list');
  assert.equal(harness.requests[0].options.headers.Authorization, undefined);
}

console.log('Tournament showcase standard auth test passed');
