import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = fs.readFileSync(new URL('../client-sdk/phab-admin-panel.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf('  function ' + name + '('), end = source.indexOf('\n  function ', start + 3);
  assert.ok(start >= 0); return source.slice(start, end).trim();
}
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; this.value = ''; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  get firstChild() { return this.children[0]; }
}
const plain = x => JSON.parse(JSON.stringify(x));
function editor(community, types) {
  const context = vm.createContext({ document: { createElement: tag => new Element(tag) }, clearNode: x => { x.children = []; } });
  vm.runInContext(extract('communityTypeSettingsPayload') + '\n' + extract('createCommunityTypeEditor'), context);
  const result = context.createCommunityTypeEditor(community, true, types);
  return { ...result, select: result.element.children.find(x => x.tag === 'select'), fields: result.element.children[2] };
}
test('shows only admitted types plus FRIENDS and builds the existing versioned payload', () => {
  const e = editor({ communityType: 'FRIENDS', typeSettingsRevision: 3 }, ['STATION','LEAGUE']);
  assert.deepEqual(e.select.children.map(x => x.value), ['FRIENDS','STATION','LEAGUE']);
  assert.deepEqual(plain(e.payload()), {});
  e.select.value = 'STATION'; e.select.listeners.change();
  e.fields.children.find(x => x.tag === 'label').children.find(x => x.tag === 'input').value = 'station-a';
  assert.deepEqual(plain(e.payload()), { communityType:'STATION',typeSettings:{stationId:'station-a'},expectedTypeSettingsRevision:3 });
});
test('existing disabled policy is read-only and ordinary edits do not emit a policy mutation', () => {
  const e = editor({ communityType:'CORPORATE',typeSettings:{categories:['open_game']},typeSettingsRevision:4 }, ['STATION','LEAGUE']);
  assert.equal(e.select.children.find(x => x.value === 'CORPORATE').disabled, true);
  assert.deepEqual(plain(e.payload()), {});
  assert.equal(e.fields.children.some(x => x.tag === 'label'), false);
  e.select.value = 'FRIENDS'; e.select.listeners.change();
  assert.deepEqual(plain(e.payload()), { communityType:'FRIENDS',typeSettings:{},expectedTypeSettingsRevision:4 });
});
test('empty allowlist admits FRIENDS only and programmatic disabled choices are rejected', () => {
  const e = editor({ communityType:'FRIENDS' }, []);
  assert.deepEqual(e.select.children.map(x => x.value), ['FRIENDS']);
  e.select.value = 'EVENT'; e.select.listeners.change();
  assert.throws(() => e.payload(), /временно недоступен/);
});
