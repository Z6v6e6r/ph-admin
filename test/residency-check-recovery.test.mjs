/**
 * Behavioural test of the served staff screen across a full page reload.
 *
 * Runs the real client-sdk/phab-residency-check.js in a fresh VM context per
 * "page load" with a minimal DOM, a scripted fetch and one sessionStorage that
 * survives the reload (as in a browser tab). No network, no real tokens.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../client-sdk/phab-residency-check.js', import.meta.url), 'utf8');
const PASS_TOKEN = 'rsp1_' + 'A'.repeat(43);
const STATION = 'station:alpha';
const STORAGE_KEY = 'phab.residency.pendingIssue.v1';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.id = '';
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.value = '';
    this.ownText = '';
    const element = this;
    this.classList = {
      add(name) {
        const set = new Set(element.className.split(/\s+/).filter(Boolean));
        set.add(name);
        element.className = [...set].join(' ');
      },
      remove(name) {
        element.className = element.className.split(/\s+/).filter((item) => item && item !== name).join(' ');
      },
      contains(name) {
        return element.className.split(/\s+/).includes(name);
      }
    };
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join(' ');
  }
  set textContent(value) {
    this.children = [];
    this.ownText = String(value);
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    child.parentNode = null;
    return child;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }
  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }
  dispatch(type) {
    for (const listener of this.listeners[type] || []) listener({ type, target: this });
  }
  click() {
    if (!this.disabled) this.dispatch('click');
  }
  focus() {}
  *walk() {
    yield this;
    for (const child of this.children) yield* child.walk();
  }
  matches(selector) {
    if (selector.startsWith('[') && selector.endsWith(']')) {
      const [name, raw] = selector.slice(1, -1).split('=');
      if (!this.hasAttribute(name)) return false;
      return raw === undefined || this.getAttribute(name) === raw.replace(/^["']|["']$/g, '');
    }
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelector(selector) {
    for (const element of this.walk()) {
      if (element !== this && element.matches(selector)) return element;
    }
    return null;
  }
}

class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.writes = [];
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.writes.push({ key, value: String(value) });
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => '' },
    text: async () => (body === undefined ? '' : JSON.stringify(body))
  };
}

function previewBody(expiresAt) {
  return {
    schemaVersion: 1,
    passId: 'resident_pass:p1',
    state: 'ACTIVE',
    issuedAt: new Date(Date.now() - 10_000).toISOString(),
    expiresAt,
    stationId: STATION,
    resident: {
      confirmed: true,
      subscriptionInstanceId: 'subscription_instance:i1',
      subscriptionTypeId: 'subscription_type:t1',
      subscriptionTypeTitle: 'Резидент',
      activeFrom: '2026-01-01T00:00:00.000Z',
      activeTo: '2027-01-01T00:00:00.000Z',
      homeStationId: STATION
    },
    services: [
      { serviceKind: 'TOWEL', label: 'Полотенце', available: true, limitQuantity: 1, remaining: 1, maxQuantity: 1 },
      { serviceKind: 'RACKET', label: 'Ракетка', available: true, returnable: true, limitQuantity: 1, remaining: 1, maxQuantity: 1 }
    ],
    issuable: true
  };
}

function issuanceBody(key) {
  return {
    schemaVersion: 1,
    issuanceId: 'resident_issuance:' + key.slice(0, 8),
    operationId: 'resident_issuance:' + key.slice(0, 8),
    state: 'ISSUED',
    stationId: STATION,
    issuedAt: new Date().toISOString(),
    items: [
      { serviceKind: 'TOWEL', label: 'Полотенце', quantity: 1, returnable: false, returnedQuantity: 0 },
      { serviceKind: 'RACKET', label: 'Ракетка', quantity: 1, returnable: true, returnedQuantity: 0 }
    ]
  };
}

/** One page load: fresh globals, shared sessionStorage, scripted fetch. */
function loadPage({ hash, storage, handler, staffRef = 'staff-ref-a', now }) {
  const PageDate = now
    ? class extends Date {
        constructor(...args) {
          super(...(args.length ? args : [now()]));
        }
        static now() {
          return now();
        }
      }
    : Date;
  const root = new FakeElement('div');
  root.id = 'phab-residency-check-root';
  const calls = [];
  const document = {
    readyState: 'complete',
    createElement: (tag) => new FakeElement(tag),
    getElementById(id) {
      for (const element of root.walk()) if (element.id === id) return element;
      return null;
    },
    addEventListener() {}
  };
  const location = { hash, pathname: '/api/ui/admin/residency/check', search: '' };
  const window = {
    __PHAB_RESIDENCY_CHECK_CONFIG__: {
      apiBase: '/api',
      permissions: ['resident-services:issue', 'resident-services:return', 'resident-services:read'],
      allowedStationIds: [STATION],
      defaultStationId: STATION,
      stationLabels: { [STATION]: 'Альфа' },
      staffRef
    },
    location,
    history: { replaceState: () => { location.hash = ''; } },
    sessionStorage: storage,
    crypto: { randomUUID: () => 'key-' + Math.random().toString(16).slice(2).padEnd(28, '0') },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    fetch: async (url, init = {}) => {
      const call = { url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
      calls.push(call);
      return handler(call);
    }
  };
  const context = vm.createContext({
    window,
    document,
    AbortController,
    Uint8Array,
    JSON,
    Date: PageDate,
    Math,
    Number,
    String,
    Object,
    Array,
    Boolean,
    Promise,
    encodeURIComponent,
    decodeURIComponent
  });
  vm.runInContext(source, context, { filename: 'phab-residency-check.js' });
  return { root, calls };
}

async function settle() {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

function findButton(root, label) {
  for (const element of root.walk()) {
    if (element.tagName === 'BUTTON' && element.textContent.trim() === label) return element;
  }
  return null;
}

async function issueWithLostResponse(storage, expiresAt) {
  const page = loadPage({
    hash: '#pass=' + PASS_TOKEN,
    storage,
    handler: (call) => {
      if (call.url.endsWith('/passes/preview')) return jsonResponse(200, previewBody(expiresAt));
      if (call.url.endsWith('/residency/profile')) return jsonResponse(503, { code: 'RESIDENCY_PROFILE_UNAVAILABLE' });
      if (call.url.endsWith('/resident-services/issuances')) throw new TypeError('network lost after commit');
      return jsonResponse(404, {});
    }
  });
  await settle();
  for (const element of page.root.walk()) {
    if (element.tagName === 'INPUT' && element.getAttribute('type') === 'checkbox') {
      element.checked = true;
      element.dispatch('change');
    }
  }
  const confirm = page.root.querySelector('[data-confirm-button]');
  assert.ok(confirm && !confirm.disabled, 'confirm button is enabled after selecting items');
  confirm.click();
  await settle();
  assert.match(page.root.textContent, /Результат неизвестен/);
  const issue = page.calls.find((call) => call.url.endsWith('/resident-services/issuances'));
  assert.ok(issue, 'issuance was sent');
  return { page, key: issue.headers['Idempotency-Key'] };
}

function assertMarkerHasNoSecrets(storage) {
  assert.ok(storage.writes.length > 0, 'the unresolved attempt is persisted before the request');
  for (const write of storage.writes) {
    assert.equal(write.key, STORAGE_KEY, 'only the recovery marker is written');
    assert.doesNotMatch(write.value, /rsp1_|Bearer|token|fullName|photo/i, 'marker carries no token or PII');
    assert.deepEqual(Object.keys(JSON.parse(write.value)).sort(), ['createdAt', 'key', 'staffRef', 'stationId', 'v']);
  }
}

test('reload after a lost response restores the committed issuance instead of a new one', async () => {
  const storage = new MemoryStorage();
  const { key } = await issueWithLostResponse(storage, new Date(Date.now() + 100_000).toISOString());
  assertMarkerHasNoSecrets(storage);

  // Full reload: the fragment token is gone, only the marker survives.
  const reloaded = loadPage({
    hash: '',
    storage,
    handler: (call) => {
      if (call.url.endsWith('/resident-services/issuance-attempts')) {
        assert.equal(call.method, 'GET');
        assert.equal(call.headers['Idempotency-Key'], key, 'the exact original key is resolved');
        return jsonResponse(200, issuanceBody(key));
      }
      return jsonResponse(500, {});
    }
  });
  await settle();
  assert.match(reloaded.root.textContent, /Выдано/);
  assert.match(reloaded.root.textContent, /Ракетка ×1/);
  assert.ok(findButton(reloaded.root, 'Вернуть ракетку'), 'the restored issuance can still be returned');
  assert.equal(reloaded.calls.length, 1, 'recovery issues one read-only lookup and nothing else');
  assert.equal(storage.getItem(STORAGE_KEY), null, 'the marker is cleared once resolved');
});

test('reload while the attempt is undetermined blocks a new issuance until staff resolves it', async () => {
  const storage = new MemoryStorage();
  await issueWithLostResponse(storage, new Date(Date.now() + 100_000).toISOString());

  // Staff scans a fresh QR, but the earlier attempt is still unresolved.
  const freshToken = 'rsp1_' + 'B'.repeat(43);
  const reloaded = loadPage({
    hash: '#pass=' + freshToken,
    storage,
    handler: (call) => {
      if (call.url.endsWith('/issuance-attempts')) return jsonResponse(404, { code: 'RESIDENT_ISSUANCE_NOT_FOUND' });
      if (call.url.includes('/journal')) return jsonResponse(200, { items: [] });
      if (call.url.endsWith('/passes/preview')) return jsonResponse(200, previewBody(new Date(Date.now() + 100_000).toISOString()));
      return jsonResponse(503, {});
    }
  });
  await settle();
  assert.match(reloaded.root.textContent, /Результат прошлой выдачи неизвестен/);
  assert.equal(reloaded.root.querySelector('[data-confirm-button]'), null, 'no confirm button while unresolved');
  assert.ok(!reloaded.calls.some((call) => call.url.endsWith('/passes/preview')), 'the new QR is not even previewed yet');
  assert.notEqual(storage.getItem(STORAGE_KEY), null, 'the marker stays on reconciliation');

  findButton(reloaded.root, 'Открыть журнал').click();
  await settle();
  assert.ok(reloaded.calls.some((call) => call.url.includes('/journal?stationId=')), 'journal is reachable from recovery');

  // Only an explicit staff decision continues to the new pass.
  findButton(reloaded.root, 'Проверено по журналу, продолжить').click();
  await settle();
  const preview = reloaded.calls.find((call) => call.url.endsWith('/passes/preview'));
  assert.ok(preview, 'the new QR is previewed after the explicit decision');
  assert.equal(preview.body.token, freshToken);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('reload after the settle window without a record reports "not saved"', async () => {
  const storage = new MemoryStorage();
  await issueWithLostResponse(storage, new Date(Date.now() + 100_000).toISOString());

  // 4 minutes later (on this device's clock) a commit could still land: stay unknown.
  const early = loadPage({
    hash: '',
    storage,
    now: () => Date.now() + 240_000,
    handler: () => jsonResponse(404, { code: 'RESIDENT_ISSUANCE_NOT_FOUND' })
  });
  await settle();
  assert.match(early.root.textContent, /Результат прошлой выдачи неизвестен/);
  assert.notEqual(storage.getItem(STORAGE_KEY), null);

  const reloaded = loadPage({
    hash: '',
    storage,
    now: () => Date.now() + 301_000,
    handler: (call) => {
      if (call.url.endsWith('/issuance-attempts')) return jsonResponse(404, { code: 'RESIDENT_ISSUANCE_NOT_FOUND' });
      return jsonResponse(503, {});
    }
  });
  await settle();
  assert.match(reloaded.root.textContent, /Прошлая выдача не сохранилась/);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('a staff session error during recovery keeps the marker and offers a manual re-check', async () => {
  const storage = new MemoryStorage();
  await issueWithLostResponse(storage, new Date(Date.now() - 120_000).toISOString());
  const reloaded = loadPage({
    hash: '',
    storage,
    handler: () => jsonResponse(401, { code: 'AUTH_REQUIRED' })
  });
  await settle();
  assert.match(reloaded.root.textContent, /Результат прошлой выдачи неизвестен/);
  assert.ok(findButton(reloaded.root, 'Проверить снова'));
  assert.notEqual(storage.getItem(STORAGE_KEY), null, '401 is not evidence that nothing was saved');
});

test('a definitive rejection clears the marker; a confirmed issuance never leaves one', async () => {
  const storage = new MemoryStorage();
  const page = loadPage({
    hash: '#pass=' + PASS_TOKEN,
    storage,
    handler: (call) => {
      if (call.url.endsWith('/passes/preview')) return jsonResponse(200, previewBody(new Date(Date.now() + 100_000).toISOString()));
      if (call.url.endsWith('/resident-services/issuances')) return jsonResponse(409, { code: 'RESIDENT_PASS_ALREADY_USED' });
      return jsonResponse(503, {});
    }
  });
  await settle();
  for (const element of page.root.walk()) {
    if (element.tagName === 'INPUT') {
      element.checked = true;
      element.dispatch('change');
    }
  }
  page.root.querySelector('[data-confirm-button]').click();
  await settle();
  assert.match(page.root.textContent, /Пропуск уже использован/);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('a different staff login never gets "not saved" for someone else\'s attempt', async () => {
  const storage = new MemoryStorage();
  await issueWithLostResponse(storage, new Date(Date.now() + 100_000).toISOString());
  const reloaded = loadPage({
    hash: '',
    storage,
    staffRef: 'staff-ref-b',
    now: () => Date.now() + 3_600_000,
    handler: (call) => {
      if (call.url.includes('/journal')) return jsonResponse(200, { items: [] });
      return jsonResponse(404, { code: 'RESIDENT_ISSUANCE_NOT_FOUND' });
    }
  });
  await settle();
  assert.match(reloaded.root.textContent, /Результат прошлой выдачи неизвестен/);
  assert.match(reloaded.root.textContent, /другой сотрудник/);
  assert.doesNotMatch(reloaded.root.textContent, /не сохранилась/);
  assert.ok(!reloaded.calls.some((call) => call.url.endsWith('/issuance-attempts')), 'no pointless lookup with a foreign key');
  assert.notEqual(storage.getItem(STORAGE_KEY), null);
});

test('a 4xx on a same-key retry after an unknown send keeps the marker', async () => {
  const storage = new MemoryStorage();
  let sends = 0;
  const page = loadPage({
    hash: '#pass=' + PASS_TOKEN,
    storage,
    handler: (call) => {
      if (call.url.endsWith('/passes/preview')) return jsonResponse(200, previewBody(new Date(Date.now() + 100_000).toISOString()));
      if (call.url.endsWith('/resident-services/issuances')) {
        sends += 1;
        if (sends === 1) throw new TypeError('timeout, first transaction may still commit');
        return jsonResponse(409, { code: 'RESIDENT_PASS_EXPIRED' });
      }
      return jsonResponse(503, {});
    }
  });
  await settle();
  for (const element of page.root.walk()) {
    if (element.tagName === 'INPUT') {
      element.checked = true;
      element.dispatch('change');
    }
  }
  page.root.querySelector('[data-confirm-button]').click();
  await settle();
  findButton(page.root, 'Повторить с тем же идентификатором').click();
  await settle();
  const issued = page.calls.filter((call) => call.url.endsWith('/resident-services/issuances'));
  assert.equal(issued.length, 2);
  assert.equal(issued[0].headers['Idempotency-Key'], issued[1].headers['Idempotency-Key'], 'retry reuses the key');
  assert.notEqual(storage.getItem(STORAGE_KEY), null, 'marker survives: the first send is still unresolved');
});
