import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const panel = readFileSync(new URL('../client-sdk/phab-admin-panel.js', import.meta.url), 'utf8');
const apiSnippet = readFileSync(new URL('../deploy/server-147/nginx-api-snippet.conf', import.meta.url), 'utf8');
const containerNginx = readFileSync(new URL('../deploy/nginx/ph-ab.conf', import.meta.url), 'utf8');
const serverReadme = readFileSync(new URL('../deploy/server-147/README.md', import.meta.url), 'utf8');
const proxyService = readFileSync(
  new URL('../src/padlhub-admin-proxy/padlhub-admin-proxy.service.ts', import.meta.url),
  'utf8'
);

const MIB = 1024 * 1024;

function functionSource(name) {
  const match = new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\(', 'm').exec(panel);
  assert.ok(match, 'served function ' + name + ' exists');
  const start = match.index + match[1].length;
  const end = panel.indexOf('\n' + match[1] + '}', start);
  assert.ok(end > start, 'served function ' + name + ' has a closing boundary');
  return panel.slice(start, end + match[1].length + 2);
}

function constantSource(name) {
  const start = panel.indexOf('var ' + name + ' =');
  assert.ok(start >= 0, 'served constant ' + name + ' exists');
  return panel.slice(start, panel.indexOf(';\n', start) + 1);
}

function blockAt(source, startIndex) {
  assert.ok(startIndex >= 0, 'block exists');
  const open = source.indexOf('{', startIndex);
  assert.ok(open >= 0, 'block has a body');
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, index + 1);
    }
  }
  throw new Error('unbalanced block');
}

function bodyLimitBytes(block) {
  const match = /client_max_body_size\s+(\d+)([kmg]?)\s*;/i.exec(block);
  assert.ok(match, 'client_max_body_size is declared');
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const factor = unit === 'k' ? 1024 : unit === 'm' ? MIB : unit === 'g' ? 1024 * MIB : 1;
  return value * factor;
}

function bridgeMediaCapBytes() {
  const match = /DEFAULT_MAX_MEDIA_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(proxyService);
  assert.ok(match, 'the bridge declares a default station-media cap');
  return Number(match[1]) * MIB;
}

const LOCATION_CONSTANTS = [
  'LOCATION_PHOTO_MAX_SOURCE_BYTES',
  'LOCATION_PHOTO_MAX_UPLOAD_BYTES',
  'LOCATION_PHOTO_MAX_DIMENSION',
  'LOCATION_PHOTO_MIME_TYPES'
];

const LOCATION_HELPERS = [
  'formatFileSize',
  'estimateDataUrlSize',
  'readImageFileAsDataUrl',
  'loadImageFromDataUrl',
  'loadImageFromFile',
  'locationPhotoMimeType',
  'locationPhotoFileName',
  'locationPhotoDataUrlToBlob',
  'locationPhotoFileFromBlob',
  'canSendLocationPhotoAsIs',
  'prepareLocationPhotoFile'
];

class FakeFileReader {
  readAsDataURL(file) {
    this.result = String((file && file.__dataUrl) || 'data:image/jpeg;base64,U09VUkNF');
    queueMicrotask(() => {
      if (this.onload) this.onload();
    });
  }
}

class FakeImage {
  constructor() {
    this.naturalWidth = 0;
    this.naturalHeight = 0;
  }

  set src(value) {
    queueMicrotask(() => {
      if (String(value).includes('UNDECODABLE')) {
        if (this.onerror) this.onerror();
        return;
      }
      this.naturalWidth = 4000;
      this.naturalHeight = 3000;
      if (this.onload) this.onload();
    });
  }
}

function setup(options = {}) {
  const canvases = [];
  const draws = [];
  const context = vm.createContext({
    window: { atob, location: { href: 'https://cup.example.invalid/' } },
    // Browsers decode through an object URL; the FileReader path stays as the fallback.
    URL: options.noObjectUrl
      ? {}
      : Object.assign(
          function URL() {},
          {
            createObjectURL(file) {
              return file && file.__undecodable ? 'blob:UNDECODABLE' : 'blob:mock';
            },
            revokeObjectURL() {}
          }
        ),
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const canvas = {
          width: 0,
          height: 0,
          getContext(kind) {
            assert.equal(kind, '2d');
            if (options.noContext) return null;
            return {
              drawImage() {
                draws.push([canvas.width, canvas.height]);
              }
            };
          },
          toDataURL(type, quality) {
            canvases.push({ width: canvas.width, height: canvas.height, type, quality });
            return options.encode ? options.encode(type, quality) : 'data:image/webp;base64,' + 'A'.repeat(400000);
          }
        };
        return canvas;
      }
    },
    FileReader: FakeFileReader,
    Image: FakeImage,
    Blob,
    File,
    atob
  });
  for (const name of LOCATION_CONSTANTS) vm.runInContext(constantSource(name), context);
  for (const name of LOCATION_HELPERS) vm.runInContext(functionSource(name), context);
  return { context, canvases, draws };
}

test('the repository ingress snippet admits the whole station-media envelope', () => {
  const apiBlock = blockAt(apiSnippet, apiSnippet.indexOf('location ^~ /api/'));
  const limit = bodyLimitBytes(apiBlock);
  assert.ok(
    limit >= bridgeMediaCapBytes(),
    'the /api/ nginx limit ' + limit + ' must cover the ' + bridgeMediaCapBytes() + ' bridge cap'
  );
  assert.ok(limit >= 16 * MIB, 'the upload location must not keep the 1m Ubuntu default');
  const containerServer = blockAt(containerNginx, containerNginx.indexOf('server {'));
  assert.ok(
    bodyLimitBytes(containerServer) >= bridgeMediaCapBytes(),
    'the CUP container nginx keeps the same floor'
  );
  assert.match(serverReadme, /client_max_body_size 20m/);
  assert.match(serverReadme, /413 Request Entity Too Large/);
});

test('a phone photo is downscaled and re-encoded before upload', async () => {
  const { context, canvases, draws } = setup({
    encode(type, quality) {
      // The first qualities are over the cap; the panel has to keep trying instead of sending them.
      const chars = quality !== undefined && quality > 0.72 ? 9000000 : 1000000;
      return type === 'image/webp'
        ? 'data:image/webp;base64,' + 'A'.repeat(chars)
        : 'data:image/jpeg;base64,' + 'A'.repeat(chars);
    }
  });
  const prepared = await context.prepareLocationPhotoFile({
    name: 'IMG_0001.JPG',
    type: 'image/jpeg',
    size: 12 * MIB
  });
  assert.equal(prepared.type, 'image/webp');
  assert.equal(prepared.name, 'IMG_0001.webp');
  assert.ok(prepared.size > 0);
  assert.ok(prepared.size <= 6 * MIB);
  assert.equal(canvases[0].width, 1600);
  assert.equal(canvases[0].height, 1200);
  assert.deepEqual(draws[0], [1600, 1200]);
  assert.ok(canvases.some((entry) => entry.quality !== undefined && entry.quality <= 0.72), 'quality loop ran');
});

test('a browser without a WebP encoder falls back to JPEG bytes', async () => {
  const { context } = setup({
    encode(type) {
      return type === 'image/webp'
        ? 'data:image/png;base64,' + 'A'.repeat(1000)
        : 'data:image/jpeg;base64,' + 'A'.repeat(400000);
    }
  });
  const prepared = await context.prepareLocationPhotoFile({
    name: 'cover.png',
    type: 'image/png',
    size: 2 * MIB
  });
  assert.equal(prepared.type, 'image/jpeg');
  assert.equal(prepared.name, 'cover.jpg');
});

test('unreadable HEIC is refused while a small undecodable JPEG still goes as-is', async () => {
  const { context } = setup();
  const heic = { name: 'IMG_0002.HEIC', type: 'image/heic', size: 3 * MIB, __undecodable: true };
  await assert.rejects(() => context.prepareLocationPhotoFile(heic), /JPEG, PNG или WebP/);

  const jpeg = { name: 'small.jpg', type: 'image/jpeg', size: 500 * 1024, __undecodable: true };
  assert.equal(await context.prepareLocationPhotoFile(jpeg), jpeg);
});

test('a JPEG the canvas cannot open gets a decode error, not a format claim', async () => {
  const { context } = setup();
  const big = { name: 'big.jpg', type: 'image/jpeg', size: 12 * MIB, __undecodable: true };
  await assert.rejects(
    () => context.prepareLocationPhotoFile(big),
    /Не удалось обработать фотографию/
  );
});

test('a file with no declared type is decided by its bytes', async () => {
  const { context } = setup();
  const prepared = await context.prepareLocationPhotoFile({ name: 'IMG_0003', type: '', size: 8 * MIB });
  assert.equal(prepared.type, 'image/webp');
});

test('the FileReader fallback still prepares the photo without object URLs', async () => {
  const { context } = setup({ noObjectUrl: true });
  const prepared = await context.prepareLocationPhotoFile({ name: 'fallback.png', type: 'image/png', size: MIB });
  assert.equal(prepared.type, 'image/webp');
  assert.equal(prepared.name, 'fallback.webp');
});

test('the panel refuses files it cannot shrink below the upload cap', async () => {
  const { context } = setup({ encode: () => 'data:image/webp;base64,' + 'A'.repeat(9000000) });
  await assert.rejects(
    () => context.prepareLocationPhotoFile({ name: 'huge.jpg', type: 'image/jpeg', size: 20 * MIB }),
    /Не удалось уменьшить фотографию/
  );
  await assert.rejects(
    () => context.prepareLocationPhotoFile({ name: 'huge.jpg', type: 'image/jpeg', size: 26 * MIB }),
    /слишком тяжёлое/
  );
  await assert.rejects(
    () => context.prepareLocationPhotoFile({ name: 'doc.pdf', type: 'application/pdf', size: 1024 }),
    /JPEG, PNG или WebP/
  );
});

test('the gallery upload path sends the prepared file to the media bridge', async () => {
  const uploaded = [];
  const statuses = [];
  const context = vm.createContext({
    locationAdminState: {
      selectedId: 'station-1',
      selectionRevision: 0,
      uploading: false,
      saving: false,
      photoUploadOperation: null,
      error: '',
      profile: null,
      items: []
    },
    notificationState: { session: null },
    notificationApi: {
      uploadLocationMedia: async (file) => {
        uploaded.push(file);
        return { mediaUrl: 'https://media.example.invalid/asset.webp' };
      }
    },
    readLocationProfileFromEditor: () => ({ gallery: [] }),
    renderLocationAdmin: () => {},
    setStatus: (message, error) => statuses.push({ message, error }),
    prepareLocationPhotoFile: async () => ({ name: 'prepared.webp', type: 'image/webp', size: 12345 })
  });
  vm.runInContext(functionSource('uploadLocationAdminPhoto'), context);
  await context.uploadLocationAdminPhoto(
    { name: 'IMG_0004.JPG', type: 'image/jpeg', size: 4 * MIB },
    {}
  );
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].name, 'prepared.webp');
  assert.equal(uploaded[0].type, 'image/webp');
  assert.equal(context.locationAdminState.profile.gallery.length, 1);
  assert.equal(context.locationAdminState.profile.gallery[0].isCover, true);
  assert.equal(context.locationAdminState.profile.gallery[0].url, 'https://media.example.invalid/asset.webp');
  assert.equal(context.locationAdminState.uploading, false);
  assert.deepEqual(statuses.at(-1), { message: 'Фотография загружена и сохранена как WebP.', error: false });
});
test('both station upload flows send the prepared file', () => {
  assert.match(
    panel,
    /var prepared = await prepareLocationPhotoFile\(file\);\s*\n\s*var asset = await notificationApi\.uploadLocationMedia\(prepared\);/
  );
  assert.match(
    panel,
    /var prepared = await prepareLocationPhotoFile\(batch\[index\]\);\s*\n\s*asset = await notificationApi\.uploadLocationMedia\(prepared\);/
  );
});

test('a 413 without a JSON body explains what the operator can do', () => {
  assert.match(panel, /response\.status === 413/);
  assert.ok(panel.includes('/\\/location-media(?:[?#]|$)/'), 'the media route is matched exactly');
  assert.match(panel, /Файл слишком большой для загрузки через ЦУП\. Выберите фотографию меньшего размера\./);
  assert.match(panel, /Запрос слишком большой для PadlHub Admin API\./);
});

console.log('CUP station photo upload test passed');
