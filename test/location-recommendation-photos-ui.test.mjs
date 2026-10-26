import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../client-sdk/phab-admin-panel.js', import.meta.url), 'utf8');
const assetId = (number) => `11111111-1111-4111-8111-${String(number).padStart(12, '0')}`;
const stationId = (number) => `22222222-2222-4222-8222-${String(number).padStart(12, '0')}`;
const plain = (value) => JSON.parse(JSON.stringify(value));

// Execute the served functions themselves, without mounting unrelated CUP modules or live services.
function functionSource(name) {
  const match = new RegExp(`^([ \\t]*)(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, `served function ${name} exists`);
  const start = match.index + match[1].length;
  const end = source.indexOf(`\n${match[1]}}`, start);
  assert.ok(end > start, `served function ${name} has a closing boundary`);
  return source.slice(start, end + match[1].length + 2);
}

function constantSource(name) {
  const start = source.indexOf(`var ${name} =`);
  assert.ok(start >= 0, `served constant ${name} exists`);
  return source.slice(start, source.indexOf(';\n', start) + 1);
}

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.attributes = new Map();
    this.events = new Map();
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.text = '';
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((node) => node.textContent).join(''); }
  set innerHTML(value) {
    assert.equal(value, '', 'new photo rows use DOM/text rather than interpolated HTML');
    this.children = [];
    this.text = '';
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(name, callback) { this.events.set(name, callback); }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map((entry) => entry.trim());
    const matches = (node) => selectors.some((entry) => {
      const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(entry);
      if (attr) return node.attributes.has(attr[1]) && (attr[2] === undefined || node.getAttribute(attr[1]) === attr[2]);
      return node.tagName === entry;
    });
    const found = [];
    for (const child of this.children) {
      if (matches(child)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function setup(overrides = {}) {
  const statuses = [];
  const rendered = [];
  const context = vm.createContext({
    URL,
    cfg: { notificationApiBaseUrl: 'https://api.example.invalid', notificationTenantKey: 'synthetic', locationRecommendationPhotosEnabled: true },
    window: { location: { href: 'https://cup.example.invalid/' } },
    document: {
      createElement: (tag) => new Element(tag),
      createTextNode: (value) => { const node = new Element('#text'); node.textContent = value; return node; }
    },
    clearNode: (node) => { node.innerHTML = ''; },
    setStatus: (message, error) => statuses.push({ message, error }),
    renderLocationAdmin: () => rendered.push(true),
    loadLocationAdmin: async () => {},
    handleError: (error) => { throw error; },
    notificationState: { session: { accessToken: 'synthetic-access-token' } },
    notificationApi: { uploadLocationMedia: async () => ({ id: assetId(1) }) },
    ...overrides
  });
  for (const name of ['LOCATION_WEEKDAYS', 'LOCATION_RECOMMENDATION_EVENT_TYPES']) {
    vm.runInContext(constantSource(name), context);
  }
  for (const name of [
    'createEmptyLocationProfile', 'editableLocationProfile', 'slugifyLocationTitle',
    'locationNullable', 'locationNumber', 'isLocationGalleryUrl', 'parseLocationIntervals',
    'locationCompleteness', 'locationRecommendationMediaUrl', 'validateLocationRecommendationPhotos',
    'readLocationProfileFromEditor', 'renderLocationRecommendationPhotos',
    'uploadLocationRecommendationPhotos', 'saveLocationAdmin'
  ]) vm.runInContext(functionSource(name), context);
  context.locationAdminState = {
    selectedId: stationId(1), version: 3, items: [],
    profile: context.editableLocationProfile({ slug: 'terekhovo', title: 'Терехово' }),
    loading: false, saving: false, uploading: false, selectionRevision: 0,
    photoUploadOperation: null, error: ''
  };
  return { context, statuses, rendered };
}

function editorFor(context) {
  const root = new Element();
  for (const name of [
    'title', 'shortTitle', 'slug', 'city', 'courtCount', 'address', 'latitude', 'longitude',
    'timezone', 'metroName', 'metroDistanceMeters', 'phoneE164', 'showOnHome', 'sortOrder'
  ]) {
    const field = new Element('input');
    field.setAttribute('data-location-field', name);
    const value = context.locationAdminState.profile[name];
    field.value = value === null || value === undefined ? '' : String(value);
    field.checked = value === true;
    root.appendChild(field);
  }
  const photos = new Element();
  photos.setAttribute('data-location-recommendation-photos', '');
  root.appendChild(photos);
  return root;
}

const binding = (number, eventType = 'GAME', isActive = false) => ({
  assetId: assetId(number), eventType, isActive, sortOrder: number - 1
});
const file = (number) => ({ name: `synthetic-${number}.webp`, type: 'image/webp', size: 100 });

test('editable station profiles preserve and deep-copy photo bindings; old responses stay editable', () => {
  const { context } = setup();
  const original = { title: 'Терехово', recommendationPhotos: [binding(1, 'GAME', true)] };
  const editable = context.editableLocationProfile(original);
  assert.deepEqual(plain(editable.recommendationPhotos), original.recommendationPhotos);
  editable.recommendationPhotos[0].isActive = false;
  assert.equal(original.recommendationPhotos[0].isActive, true);
  assert.deepEqual(plain(context.editableLocationProfile({ title: 'Legacy' }).recommendationPhotos), []);
});

test('photo validation rejects malformed IDs/types, duplicate pairs and more than 48 bindings', () => {
  const { context } = setup();
  context.validateLocationRecommendationPhotos([binding(1), binding(1, 'TRAINING')]);
  for (const photos of [
    [binding(1), binding(1)],
    [{ ...binding(1), assetId: 'https://other.example/image.webp' }],
    [{ ...binding(1), eventType: 'OTHER' }],
    [{ ...binding(1), isActive: 'true' }],
    [{ ...binding(1), sortOrder: -1 }],
    [{ ...binding(1), sortOrder: 1.5 }],
    Array.from({ length: 49 }, (_, index) => binding(index + 1))
  ]) assert.throws(() => context.validateLocationRecommendationPhotos(photos));
});

test('media URL uses the configured API/tenant and only a UUID asset', () => {
  const { context } = setup();
  assert.equal(
    context.locationRecommendationMediaUrl(assetId(1), 'https://api.example.invalid/', 'tenant /1'),
    `https://api.example.invalid/public/api/v1/tenant%20%2F1/location-media/${assetId(1)}`
  );
  assert.throws(() => context.locationRecommendationMediaUrl('javascript:alert(1)', 'https://api.example.invalid', 'synthetic'));
});

test('rendered groups expose multiple upload, activation and removal, and save reads activation', () => {
  const { context } = setup();
  context.locationAdminState.profile.recommendationPhotos = [binding(1)];
  const editor = editorFor(context);
  context.renderLocationRecommendationPhotos(editor, context.locationAdminState.profile);
  const root = editor.querySelector('[data-location-recommendation-photos]');
  assert.equal(root.querySelectorAll('input').filter((node) => node.type === 'file' && node.multiple).length, 4);
  const active = root.querySelector('[data-recommendation-active]');
  assert.ok(active);
  assert.equal(active.checked, false);
  active.checked = true;
  active.events.get('change')();
  const profile = context.readLocationProfileFromEditor(editor, true);
  assert.deepEqual(plain(profile.recommendationPhotos), [binding(1, 'GAME', true)]);
  assert.ok(root.querySelectorAll('button').some((button) => button.textContent.includes('Удалить')));
});

test('eight uploads attach to the selected station/type and start inactive', async () => {
  let calls = 0;
  const { context } = setup({ notificationApi: { uploadLocationMedia: async () => ({ id: assetId(++calls) }) } });
  await context.uploadLocationRecommendationPhotos('GAME', Array.from({ length: 8 }, (_, i) => file(i)), editorFor(context));
  assert.equal(calls, 8);
  assert.equal(context.locationAdminState.selectedId, stationId(1));
  assert.equal(context.locationAdminState.profile.recommendationPhotos.length, 8);
  assert.ok(context.locationAdminState.profile.recommendationPhotos.every((photo) => photo.eventType === 'GAME' && photo.isActive === false));
  assert.equal(context.locationAdminState.uploading, false);
});

test('duplicates in one type are skipped, while the same asset can serve another type', async () => {
  const { context } = setup();
  context.locationAdminState.profile.recommendationPhotos = [binding(1, 'GAME', true)];
  await context.uploadLocationRecommendationPhotos('GAME', [file(1)], editorFor(context));
  assert.deepEqual(plain(context.locationAdminState.profile.recommendationPhotos), [binding(1, 'GAME', true)]);
  await context.uploadLocationRecommendationPhotos('TRAINING', [file(1)], editorFor(context));
  assert.equal(context.locationAdminState.profile.recommendationPhotos.length, 2);
  assert.equal(context.locationAdminState.profile.recommendationPhotos[1].eventType, 'TRAINING');
  assert.equal(context.locationAdminState.profile.recommendationPhotos[1].isActive, false);
});

test('partial upload failure retains successful photos and restores controls', async () => {
  let calls = 0;
  const { context } = setup({ notificationApi: { uploadLocationMedia: async () => {
    calls++;
    if (calls === 2) throw new Error('Synthetic invalid file');
    return { id: assetId(calls) };
  } } });
  await context.uploadLocationRecommendationPhotos('GAME', [file(1), file(2), file(3)], editorFor(context));
  assert.equal(calls, 3);
  assert.deepEqual(plain(context.locationAdminState.profile.recommendationPhotos).map((photo) => photo.assetId), [assetId(1), assetId(3)]);
  assert.equal(context.locationAdminState.uploading, false);
});

test('authorization failure stops the batch and clears the expired shared session', async () => {
  let calls = 0;
  const { context } = setup({ notificationApi: { uploadLocationMedia: async () => {
    calls++;
    throw Object.assign(new Error('Synthetic denied'), { status: 403 });
  } } });
  await assert.rejects(
    context.uploadLocationRecommendationPhotos('GAME', [file(1), file(2)], editorFor(context)),
    (error) => error.status === 403
  );
  assert.equal(calls, 1);
  assert.equal(context.notificationState.session, null);
  assert.equal(context.locationAdminState.profile.recommendationPhotos.length, 0);
  assert.equal(context.locationAdminState.uploading, false);
});

test('a stale upload response cannot attach to a different selected station', async () => {
  let complete;
  const { context } = setup({ notificationApi: { uploadLocationMedia: () => new Promise((resolve) => { complete = resolve; }) } });
  const pending = context.uploadLocationRecommendationPhotos('GAME', [file(1)], editorFor(context));
  assert.equal(context.locationAdminState.uploading, true);
  context.locationAdminState.selectedId = stationId(2);
  context.locationAdminState.selectionRevision++;
  context.locationAdminState.profile = context.editableLocationProfile({ title: 'Other', slug: 'other' });
  complete({ id: assetId(1) });
  await pending;
  assert.equal(context.locationAdminState.selectedId, stationId(2));
  assert.equal(context.locationAdminState.profile.recommendationPhotos.length, 0);
  assert.equal(context.locationAdminState.uploading, false);
});

test('a stale rejected upload stops before starting another file', async () => {
  let reject;
  let calls = 0;
  const { context } = setup({ notificationApi: { uploadLocationMedia: () => {
    calls++;
    return new Promise((_resolve, fail) => { reject = fail; });
  } } });
  const pending = context.uploadLocationRecommendationPhotos('GAME', [file(1), file(2)], editorFor(context));
  context.locationAdminState.selectionRevision++;
  context.locationAdminState.profile = context.editableLocationProfile({ title: 'Other', slug: 'other' });
  reject(new Error('Synthetic stale rejection'));
  await pending;
  assert.equal(calls, 1);
  assert.equal(context.locationAdminState.profile.recommendationPhotos.length, 0);
});

test('a stale response cannot clear a newer upload operation', async () => {
  let complete;
  const { context } = setup({ notificationApi: { uploadLocationMedia: () => new Promise((resolve) => { complete = resolve; }) } });
  const pending = context.uploadLocationRecommendationPhotos('GAME', [file(1)], editorFor(context));
  context.locationAdminState.photoUploadOperation = 'newer-synthetic-operation';
  complete({ id: assetId(1) });
  await pending;
  assert.equal(context.locationAdminState.photoUploadOperation, 'newer-synthetic-operation');
  assert.equal(context.locationAdminState.uploading, true);
  assert.equal(context.locationAdminState.profile.recommendationPhotos.length, 0);
});

test('upload accepts only remaining slots and never exceeds 48 bindings', async () => {
  let calls = 0;
  const { context } = setup({ notificationApi: { uploadLocationMedia: async () => ({ id: assetId(47 + ++calls) }) } });
  context.locationAdminState.profile.recommendationPhotos = Array.from({ length: 47 }, (_, i) => binding(i + 1));
  await context.uploadLocationRecommendationPhotos('GAME', [file(48), file(49)], editorFor(context));
  assert.equal(calls, 1);
  assert.equal(context.locationAdminState.profile.recommendationPhotos.length, 48);
  await assert.rejects(context.uploadLocationRecommendationPhotos('GAME', [file(49)], editorFor(context)));
  assert.equal(calls, 1);
});

test('disabled photo capability omits the new field from legacy saves and blocks hidden photo loss', async () => {
  const updates = [];
  let uploads = 0;
  const { context } = setup({ cfg: { locationRecommendationPhotosEnabled: false }, notificationApi: {
    updateLocation: async (...args) => { updates.push(plain(args)); return { id: stationId(1) }; },
    uploadLocationMedia: async () => { uploads++; }
  } });
  const editor = editorFor(context);
  context.renderLocationRecommendationPhotos(editor, context.locationAdminState.profile);
  assert.equal(editor.querySelector('[data-location-recommendation-photos]').hidden, true);
  await context.saveLocationAdmin('DRAFT', editorFor(context));
  assert.equal(updates.length, 1);
  assert.equal(Object.hasOwn(updates[0][2], 'recommendationPhotos'), false);
  await assert.rejects(context.uploadLocationRecommendationPhotos('GAME', [file(1)], editorFor(context)));
  assert.equal(uploads, 0);
  context.locationAdminState.profile.recommendationPhotos = [binding(1, 'GAME', true)];
  await assert.rejects(context.saveLocationAdmin('DRAFT', editorFor(context)));
  assert.equal(updates.length, 1, 'hidden photos must never be silently discarded');
});

test('saving is blocked during upload; the normal save preserves canonical ID/version/photo activation', async () => {
  const updates = [];
  const { context } = setup({ notificationApi: {
    updateLocation: async (...args) => { updates.push(plain(args)); return { id: stationId(1) }; }
  } });
  context.locationAdminState.profile.recommendationPhotos = [binding(1, 'GAME', true)];
  let editor = editorFor(context);
  context.locationAdminState.uploading = true;
  await context.saveLocationAdmin('DRAFT', editor);
  assert.equal(updates.length, 0);
  context.locationAdminState.uploading = false;
  context.renderLocationRecommendationPhotos(editor, context.locationAdminState.profile);
  await context.saveLocationAdmin('DRAFT', editor);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], stationId(1));
  assert.equal(updates[0][1], 3);
  assert.deepEqual(updates[0][2].recommendationPhotos, [binding(1, 'GAME', true)]);
});

test('successful saves reload the canonical profile/version before the next save', async () => {
  let version = 3;
  let currentPhotos = [];
  const updates = [];
  let reads = 0;
  const { context } = setup({ notificationApi: {
    updateLocation: async (id, expectedVersion, profile) => {
      updates.push(expectedVersion);
      assert.equal(id, stationId(1));
      assert.equal(expectedVersion, version);
      currentPhotos = plain(profile.recommendationPhotos);
      version++;
      return { id };
    },
    listLocations: async () => {
      reads++;
      return { items: [{ id: stationId(1), version, title: 'Терехово', slug: 'terekhovo', recommendationPhotos: currentPhotos }] };
    }
  } });
  vm.runInContext(functionSource('loadLocationAdmin'), context);
  context.locationAdminState.profile.recommendationPhotos = [binding(1, 'GAME', true)];
  await context.saveLocationAdmin('DRAFT', editorFor(context));
  assert.equal(reads, 1);
  assert.equal(context.locationAdminState.version, 4);
  assert.deepEqual(plain(context.locationAdminState.profile.recommendationPhotos), [binding(1, 'GAME', true)]);
  await context.saveLocationAdmin('DRAFT', editorFor(context));
  assert.equal(context.locationAdminState.version, 5);
  assert.deepEqual(updates, [3, 4]);
  assert.equal(context.locationAdminState.saving, false);
});

function response(status, payload) {
  return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => payload };
}

test('the binary upload refresh retry preserves the operation key, body and tenant route', async () => {
  const calls = [];
  let sequence = 0;
  const context = vm.createContext({
    window: { crypto: { randomUUID: () => assetId(++sequence) } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/auth/session/refresh')) return response(200, { accessToken: 'synthetic-refreshed-token' });
      return calls.length === 1 ? response(401, { message: 'expired' }) : response(200, { id: assetId(1) });
    }
  });
  vm.runInContext(functionSource('createNotificationAdminApi'), context);
  const api = context.createNotificationAdminApi({ notificationApiBaseUrl: 'https://api.example.invalid', notificationTenantKey: 'synthetic', notificationAppVersion: 'test' });
  const body = file(1);
  await api.uploadLocationMedia(body);
  const uploads = calls.filter((call) => call.url.endsWith('/location-media'));
  assert.equal(uploads.length, 2);
  assert.equal(calls.length, 3);
  assert.equal(uploads[0].options.headers['Idempotency-Key'], uploads[1].options.headers['Idempotency-Key']);
  assert.equal(uploads[0].options.body, body);
  assert.equal(uploads[1].options.body, body);
  assert.equal(uploads[1].options.headers.Authorization, 'Bearer synthetic-refreshed-token');
  assert.equal(uploads[1].url, 'https://api.example.invalid/admin/api/v1/synthetic/location-media');
});

test('forbidden or ambiguous binary uploads never trigger an automatic retry', async () => {
  for (const status of [403, 500]) {
    let calls = 0;
    const context = vm.createContext({
      window: { crypto: { randomUUID: () => assetId(1) } },
      fetch: async () => { calls++; return response(status, { message: 'synthetic rejection' }); }
    });
    vm.runInContext(functionSource('createNotificationAdminApi'), context);
    const api = context.createNotificationAdminApi({ notificationApiBaseUrl: '', notificationTenantKey: 'synthetic' });
    await assert.rejects(api.uploadLocationMedia(file(1)), (error) => error.status === status);
    assert.equal(calls, 1);
  }
});

test('a second unauthorized upload terminates after one refresh and preserves the operation key', async () => {
  const calls = [];
  let sequence = 0;
  const context = vm.createContext({
    window: { crypto: { randomUUID: () => assetId(++sequence) } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return url.endsWith('/auth/session/refresh')
        ? response(200, { accessToken: 'synthetic-refreshed-token' })
        : response(401, { message: 'Synthetic unauthorized' });
    }
  });
  vm.runInContext(functionSource('createNotificationAdminApi'), context);
  const api = context.createNotificationAdminApi({ notificationApiBaseUrl: '', notificationTenantKey: 'synthetic' });
  await assert.rejects(api.uploadLocationMedia(file(1)), (error) => error.status === 401);
  const uploads = calls.filter((call) => call.url.endsWith('/location-media'));
  assert.equal(uploads.length, 2);
  assert.equal(calls.length, 3);
  assert.equal(uploads[0].options.headers['Idempotency-Key'], uploads[1].options.headers['Idempotency-Key']);
});
