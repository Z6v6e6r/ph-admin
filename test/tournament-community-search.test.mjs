import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../client-sdk/phab-admin-panel.js', import.meta.url), 'utf8');
const start = source.indexOf('    function createTournamentCommunityPublicationControl(');
const end = source.indexOf('\n    async function loadTournamentPublicationCommunities(', start);
assert.ok(start > 0 && end > start);

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.value = '';
    this.checked = false;
    this.classList = { toggle() {} };
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
}

function control(communities, selected = []) {
  const context = vm.createContext({
    document: { createElement: tag => new Element(tag) },
    normalizeArray: value => Array.isArray(value) ? value : [],
    normalizeTournamentPublicationCommunityIds: value => [...new Set(value)],
    getTournamentCommunityInitials: () => 'CM'
  });
  vm.runInContext(source.slice(start, end), context);
  const result = context.createTournamentCommunityPublicationControl(communities, selected);
  const search = result.root.children.find(x => x.type === 'search');
  const list = result.root.children.find(x => x.className === 'phab-admin-tournament-community-list');
  return {
    ...result, search, list,
    query(value) { search.value = value; search.listeners.input(); },
    visibleNames() {
      return list.children.filter(x => x.style.display !== 'none').map(x => x.children.at(-1).textContent);
    }
  };
}

const communities = [
  { id: 'a', name: 'ВСК', slug: 'vsk' },
  { id: 'b', name: 'Предприниматели-патриоты', slug: 'patriots' },
  { id: 'c', name: 'Пулково' },
  { id: 'd', name: 'Зелёный корт' }
];

test('search filters immediately, ignores case and ё/е, and clearing restores all communities', () => {
  const c = control(communities);
  assert.equal(c.search.attributes['aria-label'], 'Поиск сообщества для публикации турнира');
  c.query('  ПАТРИОТЫ  ');
  assert.deepEqual(c.visibleNames(), ['Предприниматели-патриоты']);
  c.query('vsk');
  assert.deepEqual(c.visibleNames(), ['ВСК']);
  c.query('зеленый');
  assert.deepEqual(c.visibleNames(), ['Зелёный корт']);
  c.query('');
  assert.deepEqual(c.visibleNames(), communities.map(x => x.name));
});

test('filtering and empty results preserve hidden selections and the submitted community IDs', () => {
  const c = control(communities, ['a', 'unlisted']);
  c.query('пулково');
  const checkbox = c.list.children[2].children[0];
  checkbox.checked = true;
  checkbox.listeners.change();
  assert.deepEqual(c.input.value.split(',').sort(), ['a', 'c', 'unlisted']);
  c.query('несуществующее');
  assert.deepEqual(c.visibleNames(), []);
  const empty = c.root.children.find(x => x.attributes.role === 'status');
  assert.equal(empty.style.display, '');
  assert.equal(empty.textContent, 'Сообщества не найдены.');
  c.query('');
  assert.equal(empty.style.display, 'none');
  assert.equal(c.list.children[0].children[0].checked, true);
  assert.equal(c.list.children[2].children[0].checked, true);
  assert.deepEqual(c.input.value.split(',').sort(), ['a', 'c', 'unlisted']);
});

test('an empty catalog keeps the existing empty state and selected IDs', () => {
  const c = control([], ['existing']);
  assert.equal(c.search, undefined);
  assert.equal(c.root.children[0].textContent, 'Доступных сообществ пока нет.');
  assert.equal(c.input.value, 'existing');
});
