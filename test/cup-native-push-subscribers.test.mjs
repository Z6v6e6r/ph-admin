import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../client-sdk/phab-admin-panel.js', import.meta.url), 'utf8');
class Element {
  children = []; style = {}; listeners = {}; attributes = {}; value = ''; disabled = false;
  classList = { toggle: (_name, hidden) => { this.hidden = hidden; } };
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text || ''; }
  set innerHTML(_value) { throw new Error('Rows must render untrusted names as text'); }
  appendChild(child) { this.children.push(child); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
  dispatchEvent(event) { this.listeners[event.type]?.(event); }
}
function fixture(api) {
  const block = () => ({ list: new Element(), status: new Element(), load: new Element(), more: new Element(), cursor: '', count: 0, loading: false });
  const views = { ANDROID: block(), IOS: block() };
  const dom = { notificationNativeSubscribers: views, notificationUserIdsInput: new Element(), notificationSubscribersStatus: new Element() };
  let revisions = 0;
  dom.notificationUserIdsInput.addEventListener('input', () => { revisions++; });
  const add = source.slice(source.indexOf('    function addNotificationRecipient('), source.indexOf('    async function loadNotificationSubscribers('));
  const load = source.slice(source.indexOf('    async function loadNotificationNativeSubscribers('), source.indexOf('    async function previewNotificationRecipients('));
  const ctx = vm.createContext({ notificationApi: api, dom,
    document: { createElement: () => new Element() }, window: { Event: class { constructor(type) { this.type = type; } } },
    notificationConfirmationSuffix: value => value ? ' · подтверждён ' + value : ' · подтверждение неизвестно',
    notificationSessionExpired: error => error.status === 401 || error.status === 403,
    setNotificationResult: (node, text, error) => { node.textContent = text; node.error = error; } });
  vm.runInContext(add + load, ctx);
  return { views, dom, load: ctx.loadNotificationNativeSubscribers, revisions: () => revisions };
}

test('native lists keep separate cursors, cumulative counts and append recipients without duplicates', async () => {
  const calls = [];
  const f = fixture({ listNativePushSubscribers: async (...args) => {
    calls.push(args);
    const [platform, , cursor] = args;
    return platform === 'IOS' ? { items: [] } : { items: [{ userId: cursor ? 'second' : 'first', displayName: '<script>untrusted</script>', endpointCount: 2 }], ...(cursor ? {} : { nextCursor: 'page-2' }) };
  } });
  await f.load('ANDROID', false); await f.load('IOS', false); await f.load('ANDROID', true);
  assert.deepEqual(calls, [['ANDROID', 20, ''], ['IOS', 20, ''], ['ANDROID', 20, 'page-2']]);
  assert.equal(f.views.ANDROID.list.children.length, 2);
  assert.equal(f.views.ANDROID.status.textContent, 'Найдено: 2');
  assert.equal(f.views.ANDROID.more.hidden, true);
  assert.match(f.views.IOS.status.textContent, /iOS Push не найдено/);
  assert.match(f.views.ANDROID.list.children[0].textContent, /<script>untrusted<\/script>/);
  f.dom.notificationUserIdsInput.value = 'existing';
  f.views.ANDROID.list.children[0].listeners.click();
  assert.equal(f.dom.notificationUserIdsInput.value, 'existing\nfirst');
  assert.equal(f.revisions(), 1);
  f.views.ANDROID.list.children[0].listeners.click();
  assert.equal(f.revisions(), 1);
  assert.match(f.views.ANDROID.status.textContent, /уже добавлен/);
  assert.match(f.views.IOS.status.textContent, /не найдено/);
});

test('loading prevents duplicate reads; failures keep rows and cursor for retry', async () => {
  let finish;
  const f = fixture({ listNativePushSubscribers: () => new Promise(resolve => { finish = resolve; }) });
  const request = f.load('ANDROID', false);
  assert.equal(f.views.ANDROID.load.disabled, true);
  assert.match(f.views.ANDROID.status.textContent, /Загружаем/);
  await f.load('ANDROID', false);
  finish({ items: [{ userId: 'one' }], nextCursor: 'retry-page' }); await request;
  assert.equal(f.views.ANDROID.load.disabled, false);
  // The second fixture starts with a successful page to prove failed refresh does not wipe it.
  let fail = false;
  const g = fixture({ listNativePushSubscribers: async () => {
    if (fail) throw new Error('Временно недоступно');
    return { items: [{ userId: 'one' }], nextCursor: 'retry-page' };
  } });
  await g.load('IOS', false); fail = true; await g.load('IOS', true);
  assert.equal(g.views.IOS.list.children.length, 1);
  assert.equal(g.views.IOS.cursor, 'retry-page');
  assert.equal(g.views.IOS.status.error, true);
  assert.equal(g.views.IOS.loading, false);
  assert.equal(g.views.IOS.more.disabled, false);
});
