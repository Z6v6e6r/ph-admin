import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../client-sdk/phab-qr-links-admin.js', import.meta.url), 'utf8');
const uiController = readFileSync(new URL('../src/ui/ui.controller.ts', import.meta.url), 'utf8');
const clientScript = readFileSync(new URL('../src/client-script/client-script.controller.ts', import.meta.url), 'utf8');
const releaseMaintenance = readFileSync(new URL('../src/common/release-maintenance.ts', import.meta.url), 'utf8');
const copyScript = readFileSync(new URL('../scripts/copy-client-sdk.mjs', import.meta.url), 'utf8');

test('QR links UI mounts only when enabled and follows the CUP tab pattern', () => {
  assert.match(source, /qrLinksAdminEnabled !== true/);
  assert.match(source, /\.phab-admin-tabs/);
  assert.match(source, /\.phab-admin-content/);
  assert.match(source, /\.phab-admin-mobile-tab-select/);
  assert.match(source, /phab-admin-tab-active/);
  assert.match(source, /option\.value = 'qr-links'/);
  for (const marker of [
    'QR-коды',
    'Создавайте постоянные QR-ссылки, меняйте адрес перехода и отслеживайте использование',
    'Создать QR',
    'Всего QR',
    'Активных QR',
    'Переходов за выбранный период',
    'Показатели учитывают выбранные фильтры',
    'Europe/Moscow'
  ]) assert.ok(source.includes(marker), marker);
});

test('QR links UI talks to the documented admin endpoints', () => {
  for (const marker of [
    '/v1/admin/qr-links',
    '/stations',
    '/stats',
    '/history',
    '/image',
    'queryString({ format: format })',
    'Idempotency-Key',
    'Idempotency-Replayed',
    'expectedVersion',
    "method: 'POST'",
    "method: 'PATCH'"
  ]) assert.ok(source.includes(marker), marker);
  assert.match(source, /status: state\.filters\.status \|\| undefined/);
  assert.match(source, /sort: state\.sort/);
  assert.match(source, /direction: state\.direction/);
  assert.match(source, /page: state\.page/);
  assert.match(source, /pageSize: state\.pageSize/);
});

test('QR is rendered by the backend and displayed as an authenticated blob', () => {
  assert.match(source, /\/image' \+ queryString/);
  assert.match(source, /\.blob\(\)/);
  assert.match(source, /createObjectURL/);
  assert.match(source, /revokeObjectURL/);
  assert.doesNotMatch(source, /\/image[^;]*targetUrl/);
  // The UI must never encode the QR itself: no QR library, canvas or data URL generation.
  assert.doesNotMatch(source, /QRCode|qrcode|toDataURL|getContext|createImageData|canvas/i);
});

test('open target uses the saved targetUrl directly, never the short link', () => {
  assert.ok(source.includes("global.open(String(state.card.targetUrl), '_blank', 'noopener')"));
  assert.doesNotMatch(source, /global\.open\([^)]*shortUrl/);
  assert.match(source, /Открыть целевой адрес/);
});

test('copy and download use clipboard with fallback and authenticated blob anchors', () => {
  assert.match(source, /navigator\.clipboard/);
  assert.match(source, /writeText/);
  assert.match(source, /execCommand\('copy'\)/);
  assert.match(source, /anchor\.download = 'qr-' \+ safeCode \+ '\.' \+ ext/);
  assert.match(source, /safeCode \+ '\.' \+ ext/);
  assert.ok(source.includes('data-format="png"'));
  assert.ok(source.includes('data-format="svg"'));
  for (const marker of ['Копировать ссылку', 'Скачать PNG', 'Скачать SVG']) {
    assert.ok(source.includes(marker), marker);
  }
});

test('archive requires explicit confirmation and never hard-deletes', () => {
  assert.match(source, /global\.confirm/);
  assert.ok(source.includes('Архивировать QR-код'));
  assert.ok(source.includes('перестанут перенаправлять'));
  assert.doesNotMatch(source, /method: 'DELETE'/);
});

test('create reuses one Idempotency-Key for the same intent and conflicts are explained', () => {
  assert.match(source, /crypto\.randomUUID/);
  assert.match(source, /intent\.key/);
  assert.match(source, /intent\.signature/);
  assert.match(source, /Number\(error\.status\) === 409/);
  assert.ok(source.includes('Код изменился в другом окне. Обновите данные и повторите действие.'));
});

test('permission gating covers qr:read and qr:manage with a clear no-access state', () => {
  assert.match(source, /hasOwnProperty\.call\(config, 'permissions'\)/);
  assert.match(source, /can\('qr:read'\)/);
  assert.match(source, /can\('qr:manage'\)/);
  assert.ok(source.includes('Нет доступа к разделу «QR-коды»'));
});

test('card view renders QR, public link, target URL, counters and history', () => {
  for (const marker of [
    'Публичная ссылка',
    'Адрес перехода',
    'Адрес QR постоянный. Изменение страницы назначения не требует перепечатки кода.',
    'Ежедневная статистика',
    'История изменений',
    'totalQr',
    'activeQr',
    'redirectsPeriod',
    'totals',
    'daily',
    'actorLogin',
    'Повторные открытия учитываются',
    'Показатель не подтверждает загрузку целевой страницы'
  ]) assert.ok(source.includes(marker), marker);
  assert.doesNotMatch(source, /history[^;]*metadata/);
});

test('form covers required fields and keeps the public short link read-only', () => {
  for (const marker of [
    'Название',
    'Станция',
    'Размещение',
    'Описание',
    'Адрес перехода',
    'Статус',
    'Общий QR / без станции',
    'Активен',
    'На паузе',
    'В архиве',
    'Публичная ссылка (не меняется)',
    'https://padlhub.ru/...'
  ]) assert.ok(source.includes(marker), marker);
  assert.match(source, /required/);
});

test('deep link activates the tab and syncs section/qrId through replaceState', () => {
  assert.match(source, /config\.qrSection/);
  assert.match(source, /config\.qrId/);
  assert.match(source, /params\.set\('section', 'qr-links'\)/);
  assert.match(source, /history\.replaceState/);
  // Deep links never navigate away from the CUP admin page.
  assert.doesNotMatch(source, /location\.href\s*=/);
  assert.doesNotMatch(source, /location\.assign|location\.replace/);
  assert.ok(source.includes("'/api/ui/admin'"));
});

test('no inline handlers and mobile layout keeps primary actions reachable', () => {
  assert.doesNotMatch(source, /\son[a-z]+\s*=\s*['"]/i);
  assert.doesNotMatch(source, /javascript:/i);
  assert.match(source, /\.phab-qr-card\{min-width:0;max-width:100%/);
  assert.match(source, /\.phab-qr-head,\.phab-qr-card-head,\.phab-qr-public\{flex-direction:column\}/);
  assert.match(source, /\.phab-qr-table-wrap\{[^}]*overflow-x:auto/);
  assert.match(source, /@media\(max-width:640px\)/);
  assert.match(source, /data-action="menu"/);
  assert.match(source, /\.phab-qr-rowmenu/);
});

test('admin panel wiring serves and loads the QR script', () => {
  assert.match(uiController, /qrLinksAdminEnabled/);
  assert.match(uiController, /process\.env\.QR_LINKS_ENABLED/);
  assert.match(uiController, /qrSection/);
  assert.match(uiController, /qrId/);
  assert.ok(uiController.includes('<script src="/api/client-script/qr-links-admin.js"></script>'));
  assert.match(clientScript, /@Get\('qr-links-admin\.js'\)/);
  assert.match(clientScript, /phab-qr-links-admin\.js/);
  assert.match(releaseMaintenance, /'\/api\/client-script\/qr-links-admin\.js'/);
  assert.match(copyScript, /'phab-qr-links-admin\.js'/);
});
