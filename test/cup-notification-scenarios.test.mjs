import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../client-sdk/phab-admin-panel.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0);
  const end = source.indexOf('\n  function ', start + 3);
  return source.slice(start, end < 0 ? undefined : end).trim();
}
const plain = value => JSON.parse(JSON.stringify(value));
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; this.checked = false; this.disabled = false; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(key, value) { this.attributes[key] = value; }
  get textContent() { return this._text || this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = value; this.children = []; if (this.tag === 'select') delete this._value; }
  get value() { return this._value ?? (this.tag === 'select' ? this.children.find(child => !child.disabled)?.value || '' : ''); }
  set value(value) { this._value = value; }
  set innerHTML(_value) { throw new Error('Scenario UI must use textContent for rendered values'); }
  addEventListener(event, handler) { (this.listeners[event] ||= []).push(handler); }
  async fire(event) { for (const handler of this.listeners[event] || []) await handler({ preventDefault() {} }); }
  reportValidity() { return true; }
}
function all(node) { return [node, ...node.children.flatMap(all)]; }
function fixture(overrides = {}) {
  let command = 0;
  const host = new Element('section');
  const api = {
    listScenarios: async () => ({ items: [], runtimeEnabled: false, catalog: [
      'BOOKING_STARTS', 'BIRTHDAY', 'SUBSCRIPTION_ENDS', 'TRAINING_ATTENDED', 'FRIEND_GAME_PUBLISHED'
    ].map(type => ({ type, available: true, reason: null })) }),
    listScenarioRuns: async () => ({ items: [] }),
    scenarioCommandKey: () => 'synthetic-command-' + (++command),
    saveScenario: async (_id, _version, definition) => ({ id: '11111111-1111-4111-8111-111111111111', version: 1, definition }),
    ...overrides
  };
  const create = vm.runInNewContext(extract('createNotificationScenariosPane') + ';createNotificationScenariosPane', {
    document: { createElement: tag => new Element(tag) },
  });
  const pane = create(host, api, () => false);
  const byText = (tag, text) => all(host).find(node => node.tag === tag && node.textContent === text);
  const field = text => byText('label', text)?.children.find(node => ['input', 'textarea', 'select'].includes(node.tag)) ||
    all(host).find(node => node.tag === 'label' && node.children[0]?.textContent === text)?.children[1];
  return { host, api, pane, byText, field, form: all(host).find(node => node.tag === 'form'),
    fields: all(host).find(node => node.tag === 'fieldset'),
    status: all(host).find(node => node.attributes.role === 'status') };
}
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };

test('scenario commands reuse exact admin root, bearer and caller-owned key across refresh', async () => {
  const calls = []; let first = true;
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const refresh = url.endsWith('/auth/session/refresh');
    const status = !refresh && first ? (first = false, 401) : 200;
    return { ok: status === 200, status, headers: { get: () => 'application/json' },
      json: async () => refresh ? { accessToken: 'synthetic-refreshed' } : { items: [] } };
  };
  const create = vm.runInNewContext(extract('createNotificationAdminApi') + ';createNotificationAdminApi', {
    window: { crypto: { randomUUID: () => 'synthetic-correlation' } }, fetch, AbortController, setTimeout, clearTimeout,
  });
  const api = create({ notificationApiBaseUrl: 'https://api.example.test', notificationTenantKey: 'synthetic', notificationAppVersion: 'test' });
  api.setAccessToken('synthetic-original');
  await api.saveScenario(null, 0, { name: 'synthetic' }, 'synthetic-stable-command');
  const writes = calls.filter(call => call.url.endsWith('/notifications/scenarios'));
  assert.equal(writes.length, 2);
  for (const call of writes) {
    assert.equal(call.url, 'https://api.example.test/admin/api/v1/synthetic/notifications/scenarios');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers['Idempotency-Key'], 'synthetic-stable-command');
    assert.equal(call.options.headers['X-App-Platform'], 'cup-admin');
    assert.equal(call.options.credentials, 'include');
  }
  assert.equal(writes[1].options.headers.Authorization, 'Bearer synthetic-refreshed');
  await api.saveScenario('a/b', 3, { name: 'synthetic' }, 'synthetic-put-command');
  assert.equal(calls.at(-1).url.endsWith('/notifications/scenarios/a%2Fb'), true);
  assert.equal(calls.at(-1).options.method, 'PUT');
});

test('does not request scenarios until authenticated workspace activation; suspend fences late reads', async () => {
  let reads = 0, release;
  const f = fixture({ listScenarios: async () => { reads++; return await new Promise(resolve => { release = resolve; }); } });
  assert.equal(reads, 0); assert.equal(f.fields.disabled, true);
  f.pane.activate(); assert.equal(reads, 1);
  f.pane.suspend();
  release({ items: [{ id: 'stale', version: 1, definition: { name: 'private stale title' } }], catalog: [] });
  await settle();
  assert.equal(f.host.textContent.includes('private stale title'), false);
  assert.equal(f.fields.disabled, true);
});

test('supports negative birthday offset, selected channel order and mobile inbox prerequisite', async () => {
  let saved;
  const f = fixture({ saveScenario: async (_id, _version, definition) => { saved = plain(definition); return { id: '11111111-1111-4111-8111-111111111111', version: 1, definition }; } });
  f.pane.activate(); await settle();
  f.field('Триггер').value = 'BIRTHDAY'; await f.field('Триггер').fire('change');
  f.field('Название').value = 'Synthetic birthday';
  f.field('Сдвиг, минут: минус — до события, плюс — после').value = '-1440';
  const email = f.byText('label', ' Email').children[0]; email.checked = true; await email.fire('change');
  const ios = f.byText('label', ' iOS Push').children[0]; ios.checked = true; await ios.fire('change');
  assert.equal(f.byText('label', ' Центр уведомлений').children[0].disabled, true);
  await f.form.fire('submit');
  assert.equal(saved.trigger, 'BIRTHDAY'); assert.equal(saved.delayMinutes, -1440);
  assert.deepEqual(saved.channels, ['IN_APP', 'EMAIL', 'IOS_PUSH']); assert.equal(saved.active, false);
});

test('ambiguous save locks edits and replays identical body/version/key; acknowledged journal failure is not retried', async () => {
  const calls = []; let failSave = true, failJournal = false;
  const f = fixture({
    saveScenario: async (...args) => { calls.push(plain(args)); if (failSave) { failSave = false; throw new Error('synthetic timeout'); }
      failJournal = true; return { id: '11111111-1111-4111-8111-111111111111', version: 1, definition: args[2] }; },
    listScenarioRuns: async () => { if (failJournal) throw new Error('synthetic journal unavailable'); return { items: [] }; },
  });
  f.pane.activate(); await settle();
  f.field('Название').value = 'Synthetic'; await f.form.fire('submit');
  assert.equal(f.fields.disabled, true); assert.match(f.status.textContent, /Результат сохранения неизвестен/);
  f.field('Название').value = 'Must not replace pending body';
  await f.form.fire('submit');
  assert.deepEqual(calls[0], calls[1]); assert.equal(f.fields.disabled, false);
  assert.match(f.status.textContent, /Сценарий сохранён/);
  await f.form.fire('submit');
  assert.notEqual(calls[2][3], calls[1][3]); assert.equal(calls[2][1], 1);
});

test('version conflict requires reload and never overwrites a newer server version', async () => {
  let calls = 0;
  const f = fixture({ saveScenario: async () => { calls++; throw Object.assign(new Error('synthetic conflict'), { status: 409 }); } });
  f.pane.activate(); await settle(); await f.form.fire('submit');
  assert.equal(f.fields.disabled, true);
  await f.form.fire('submit'); assert.equal(calls, 1);
  await f.byText('button', 'Обновить сценарии и журнал').fire('click'); await settle();
  assert.equal(f.fields.disabled, false);
});

test('journal renders untrusted titles as text and distinguishes UNKNOWN from accepted delivery', async () => {
  const title = '<img src=x onerror=alert(1)>';
  const f = fixture({
    listScenarios: async () => ({ runtimeEnabled: true, catalog: [], items: [{ id: 's', version: 1, definition: { name: title } }] }),
    listScenarioRuns: async () => ({ items: [{ scenarioId: 's', recipientUserId: 'synthetic-user', dueAt: '2026-10-22T12:00:00Z', state: 'QUEUED', goalState: 'NONE', deliveryStates: [{ channel: 'EMAIL', state: 'DEAD', count: 1, errorCode: 'SMTP_OUTCOME_UNKNOWN' }] }] }),
  });
  f.pane.activate(); await settle();
  assert.equal(f.host.textContent.includes(title), true);
  assert.match(f.host.textContent, /Результат неизвестен, без автоматического повтора/);
  assert.equal(all(f.host).some(node => node.tag === 'img'), false);
});

for (const malformed of [null, {}]) {
  test('malformed successful save retains exact pending command: ' + JSON.stringify(malformed), async () => {
    const calls = []; let broken = true;
    const f = fixture({ saveScenario: async (...args) => {
      calls.push(plain(args));
      if (broken) return malformed;
      return { id: '11111111-1111-4111-8111-111111111111', version: args[1] + 1, definition: args[2] };
    } });
    f.pane.activate(); await settle();
    f.field('Название').value = 'Synthetic malformed reply';
    await f.form.fire('submit');
    assert.equal(f.fields.disabled, true);
    assert.match(f.status.textContent, /Результат сохранения неизвестен/);
    assert.equal(f.byText('button', 'Новый сценарий').disabled, true);
    broken = false; await f.form.fire('submit');
    assert.deepEqual(calls[1], calls[0]);
    assert.equal(f.fields.disabled, false);
  });
}

function extractInner(name) {
  const start = source.indexOf('    async function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n    async function ', start + 8);
  return source.slice(start, end < 0 ? undefined : end).trim();
}
for (const entry of ['ensureNotificationSession', 'submitNotificationLogin']) {
  for (const allowed of [true, false]) {
    test(entry + ' waits for capability proof before scenario reads, allowed=' + allowed, async () => {
      let reads = 0, capabilityRequests = 0, resolveCapabilities, rejectCapabilities;
      const deferred = new Promise((resolve, reject) => { resolveCapabilities = resolve; rejectCapabilities = reject; });
      const f = fixture({
        listScenarios: async () => { reads++; return { items: [], catalog: [], runtimeEnabled: false }; },
        listScenarioRuns: async () => { reads++; return { items: [] }; },
      });
      const notificationState = { session: null, capabilities: null, restoring: false, busy: '', challengeId: 'synthetic-challenge' };
      const context = {
        notificationState,
        notificationApi: {
          restoreSession: async () => ({ accessToken: 'synthetic-cookie-session' }),
          verifyCode: async () => ({ accessToken: 'synthetic-otp-session' }),
          getCapabilities: async () => { capabilityRequests++; return await deferred; },
        },
        dom: { notificationAuthStatus: {}, notificationCodeInput: { value: '1234' } },
        readStoredNotificationToken: () => '',
        setNotificationResult() {}, updateNotificationControls() {}, setStatus() {}, renderNotificationCapabilities() {},
        showNotificationWorkspace() { f.pane.activate(); },
        showNotificationAuth() { notificationState.session = null; f.pane.suspend(); },
      };
      const execute = vm.runInNewContext(extractInner('loadNotificationCapabilities') + '\n' + extractInner(entry) + ';' + entry, context);
      const work = execute(); await settle();
      assert.equal(capabilityRequests, 1);
      assert.equal(reads, 0);
      if (allowed) resolveCapabilities({ channels: [] });
      else rejectCapabilities(Object.assign(new Error('synthetic permission denied'), { status: 403 }));
      await work; await settle();
      assert.equal(reads, allowed ? 2 : 0);
      assert.equal(f.fields.disabled, !allowed);
    });
  }
}

test('scenario request has one bounded deadline across auth refresh and preserves caller key', async () => {
  let deadline, cleared = 0, captured;
  const create = vm.runInNewContext(extract('createNotificationAdminApi') + ';createNotificationAdminApi', {
    window: { crypto: { randomUUID: () => 'synthetic-correlation' } }, AbortController,
    setTimeout(fn, milliseconds) { assert.equal(milliseconds, 30000); deadline = fn; return 1; },
    clearTimeout(id) { assert.equal(id, 1); cleared++; },
    fetch: async (_url, options) => {
      captured = options;
      return await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('synthetic abort'))));
    },
  });
  const api = create({ notificationApiBaseUrl: 'https://api.example.test', notificationTenantKey: 'synthetic' });
  const work = api.saveScenario(null, 0, { name: 'Synthetic' }, 'synthetic-deadline-key');
  assert.equal(captured.headers['Idempotency-Key'], 'synthetic-deadline-key');
  deadline();
  await assert.rejects(work, /synthetic abort/);
  assert.equal(cleared, 1);
});
