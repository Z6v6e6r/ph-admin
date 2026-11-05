import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const js = readFileSync(new URL('../client-sdk/phab-residency-check.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../client-sdk/phab-residency-check.css', import.meta.url), 'utf8');

/** Extract a top-level IIFE function body (all module functions use 2-space indent). */
function sourceOf(name) {
  const match = new RegExp('^  (?:async )?function ' + name + '\\(', 'm').exec(js);
  assert.ok(match, 'served function ' + name + ' exists');
  const end = js.indexOf('\n  }\n', match.index);
  assert.ok(end > match.index, 'served function ' + name + ' has a closing boundary');
  return js.slice(match.index, end + 4);
}

test('asset is a strict dependency-free IIFE with DOMContentLoaded auto-init', () => {
  assert.match(js, /\(function \(\) \{\n  'use strict';/);
  assert.match(js, /\}\)\(\);\s*$/);
  assert.match(js, /document\.readyState === 'loading'/);
  assert.match(js, /document\.addEventListener\('DOMContentLoaded', boot\)/);
  assert.match(js, /window\.PHABResidencyCheck/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|document\.cookie|sendBeacon|console\./);
  assert.doesNotMatch(js, /XMLHttpRequest|setInterval/);
  assert.doesNotMatch(js, /https?:\/\//);
  assert.doesNotMatch(js, /аналитик|экспорт|склад|CRM|inventory|warehouse/i);
});

test('reads the rsp1_ page config contract', () => {
  for (const key of [
    '__PHAB_RESIDENCY_CHECK_CONFIG__',
    'passToken',
    'allowedStationIds',
    'defaultStationId',
    'stationLabels',
    'permissions',
    'demoMode',
    'apiBase'
  ]) {
    assert.match(js, new RegExp(key), 'config key ' + key);
  }
  assert.match(js, /CONFIG_VERSION = 'rsp1_'/);
  assert.match(js, /version: CONFIG_VERSION/);
  assert.match(js, /'\/api'/);
});

test('calls the D resident-services API directly and no removed E proxy routes', () => {
  assert.match(js, /'\/v1\/admin\/resident-services\/passes\/preview'/);
  assert.match(js, /'\/v1\/admin\/resident-services\/issuances'/);
  assert.match(js, /\/v1\/admin\/resident-services\/issuances\/' \+ encodeURIComponent\(state\.returnTarget\.issuanceId\) \+ '\/returns'/);
  assert.match(js, /'\/v1\/admin\/resident-services\/journal\?stationId='/);
  assert.match(js, /'\/v1\/admin\/residency\/profile\?subscriptionInstanceId='/);
  assert.doesNotMatch(js, /\/v1\/admin\/residency\/(check|issue|returns|journal)/);
});

test('preview request carries token and stationId with a command header', () => {
  const loadCheck = sourceOf('loadCheck');
  assert.match(loadCheck, /'\/v1\/admin\/resident-services\/passes\/preview'/);
  assert.match(loadCheck, /JSON\.stringify\(\{ token: token, stationId: state\.stationId \}\)/);
  assert.match(loadCheck, /mutationHeaders\(null\)/);
  assert.match(loadCheck, /'\/v1\/admin\/residency\/profile\?subscriptionInstanceId=' \+ encodeURIComponent\(subscriptionInstanceId\)/);
  assert.match(loadCheck, /state\.profile = profileOutcome\.body/);
});

test('issue body uses serviceKind/station and one idempotency key per intent', () => {
  const ensure = sourceOf('ensureIssueIntent');
  assert.match(ensure, /newIdempotencyKey\(\)/);
  assert.match(ensure, /body: \{ token: passToken\(\), stationId: state\.stationId, items: items \}/);
  assert.match(ensure, /serviceKind: serviceKind, quantity: Math\.max\(1, Number\(state\.selection\[serviceKind\]\) \|\| 1\)/);
  assert.match(ensure, /signature: signature/);
  assert.match(js, /headers\['Idempotency-Key'\] = intentKey/);
  assert.match(sourceOf('mutationHeaders'), /'Idempotency-Key'/);
  assert.match(js, /'X-Correlation-ID': newCorrelationId\(\)/);
});

test('manual retry reuses the exact key and body; nothing auto-retries a POST', () => {
  const retry = sourceOf('retryIssue');
  assert.match(retry, /submitIssue\(state\.issueIntent\)/);
  assert.doesNotMatch(retry, /newIdempotencyKey|ensureIssueIntent/);

  const submit = sourceOf('submitIssue');
  assert.match(submit, /headers: mutationHeaders\(intent\.key\)/);
  assert.match(submit, /body: JSON\.stringify\(intent\.body\)/);
  assert.match(submit, /demoMode\(\)/);

  assert.equal((js.match(/submitIssue\(/g) ?? []).length, 3, 'definition + confirmIssue + retryIssue only');
  assert.equal((js.match(/resident-services\/issuances'/g) ?? []).length, 1, 'one issuance POST call site');
  assert.match(js, /Повторить с тем же идентификатором/);
  assert.match(js, /Результат неизвестен/);
});

test('success is gated by server ids, never optimistic', () => {
  const confirmed = sourceOf('isIssueConfirmed');
  assert.match(confirmed, /typeof body\.issuanceId === 'string'/);

  const submit = sourceOf('submitIssue');
  const gate = submit.indexOf('isIssueConfirmed(outcome.body)');
  const success = submit.indexOf("state.phase = 'success'");
  assert.ok(gate >= 0 && success > gate, 'success state only after the issuanceId gate');

  const returned = sourceOf('isReturnConfirmed');
  assert.match(returned, /typeof body\.returnId === 'string'/);
  assert.match(sourceOf('submitReturn'), /isReturnConfirmed\(outcome\.body\)/);
});

test('renders required resident, station, residency and service fields', () => {
  for (const token of [
    'phab-rc-photo',
    'phab-rc-photo-fallback',
    'initials',
    'profile.fullName',
    'profile.photoUrl',
    'phab-rc-name',
    'phab-rc-station',
    'phab-rc-home-station',
    'homeStationId',
    'subscriptionTypeTitle',
    'statusLabel',
    'termLabel',
    'deriveResidency',
    'phab-rc-pill',
    'phab-rc-service',
    'remaining',
    'limitQuantity',
    'blocker',
    'staticBlockerReason',
    'phab-rc-service-reason',
    'issuable',
    'phab-rc-issuable-note'
  ]) {
    assert.ok(js.includes(token), 'renders ' + token);
  }
  assert.match(js, /'до ' \+ formatTermDate\(activeTo\)/);
  assert.match(js, /'Активно'/);
  assert.match(js, /'Истекает'/);
  assert.match(js, /14 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(js, /'Домашняя станция: '/);
  assert.match(js, /'Станция: '/);
});

test('station selection flow: auto single, selector for scoped multiple, explicit input for global', () => {
  assert.match(js, /'Выберите станцию'/);
  const boot = sourceOf('boot');
  assert.match(boot, /defaultStationId\(\)/);
  assert.match(boot, /allowedStationIds\(\)/);
  assert.match(boot, /allowed\.length === 1/);
  assert.match(js, /phab-rc-station-radio/);
  assert.match(js, /phab-rc-station-input/);
  assert.match(js, /role', 'radiogroup'/);
  assert.match(js, /chooseStation/);
  assert.doesNotMatch(js, /Выберите станцию. Сначала/);
});

test('selection uses available services only with quantity steppers and a sticky confirm bar', () => {
  assert.match(js, /available && canIssue/);
  assert.match(js, /phab-rc-service-input/);
  assert.match(js, /phab-rc-step/);
  assert.match(js, /stepQuantity/);
  assert.match(js, /phab-rc-confirm/);
  assert.match(js, /'Выбрано: '/);
  assert.match(js, /selectedCount\(\) === 0/);
  assert.match(js, /state\.phase === 'issuing'/);
});

test('return flow has its own key, default racket quantity and permission gate', () => {
  const ensure = sourceOf('ensureReturnIntent');
  assert.match(ensure, /newIdempotencyKey\(\)/);
  assert.match(ensure, /serviceKind: 'RACKET'/);

  const returnable = sourceOf('issueReturnableQuantity');
  assert.match(returnable, /item\.returnable === false/);
  assert.match(returnable, /returnedQuantity/);

  const submit = sourceOf('submitReturn');
  assert.match(submit, /mutationHeaders\(intent\.key\)/);
  assert.match(submit, /'\/returns'/);
  assert.match(submit, /isReturnConfirmed\(outcome\.body\)/);
  assert.match(submit, /state\.journal = null/);
  assert.match(js, /'Вернуть ракетку'/);
  assert.match(sourceOf('successCard'), /hasPermission\(PERMISSION_RETURN\)/);
  assert.match(sourceOf('journalItem'), /hasPermission\(PERMISSION_RETURN\)/);
});

test('journal renders D events and hides without read permission', () => {
  assert.match(js, /'ISSUANCE_CONFIRMED'/);
  assert.match(js, /'ITEM_RETURNED'/);
  assert.match(js, /occurredAt/);
  assert.match(js, /eventItemsText/);
  assert.match(js, /phab-rc-journal/);
  assert.match(sourceOf('loadJournal'), /'\/v1\/admin\/resident-services\/journal\?stationId='/);
  assert.match(js, /hasPermission\(PERMISSION_READ\)/);
  assert.match(js, /нет права чтения/);
});

test('permission gating hides issue/return controls with a notice', () => {
  assert.match(js, /PERMISSION_ISSUE = 'resident-services:issue'/);
  assert.match(js, /PERMISSION_RETURN = 'resident-services:return'/);
  assert.match(js, /PERMISSION_READ = 'resident-services:read'/);
  assert.match(js, /phab-rc-permission-notice/);
  assert.match(js, /hasPermission\(PERMISSION_ISSUE\) && state\.preview\.issuable !== false/);
  assert.match(js, /Нет права подтверждать выдачу/);
});

test('demo mode is deterministic, local and clearly marked', () => {
  for (const token of [
    'demoMode',
    'demoPreview',
    'demoProfile',
    'demoIssue',
    'demoReturn',
    'demoJournalEntries',
    'Демо-данные',
    'Анна Резидентова',
    "passId: 'demo-active'",
    "serviceKind: 'RACKET'",
    "serviceKind: 'TOWEL'"
  ]) {
    assert.ok(js.includes(token), 'demo token ' + token);
  }
  assert.match(js, /demoMode\(\)/);
  assert.doesNotMatch(js, /демо-режим/i);
});

test('maps the stable D error codes', () => {
  for (const code of [
    'RESIDENT_PASS_NOT_FOUND',
    'RESIDENT_PASS_INVALID',
    'RESIDENT_PASS_EXPIRED',
    'RESIDENT_PASS_ALREADY_USED',
    'RESIDENT_NOT_ACTIVE',
    'RESIDENT_TERM_EXPIRED',
    'RESIDENT_STATION_REQUIRED',
    'RESIDENT_STATION_FORBIDDEN',
    'RESIDENT_SERVICE_NOT_CONFIGURED',
    'RESIDENT_SERVICE_LIMIT_EXCEEDED',
    'RESIDENT_SERVICES_IDEMPOTENCY_CONFLICT',
    'RESIDENT_SERVICES_IDEMPOTENCY_KEY_INVALID',
    'RESIDENT_ISSUANCE_NOT_FOUND',
    'RESIDENT_SERVICES_DISABLED',
    'RESIDENT_SERVICES_PERSISTENCE_UNAVAILABLE',
    'RESIDENT_SERVICES_NOT_CONFIGURED'
  ]) {
    assert.ok(js.includes(code), 'maps error code ' + code);
  }
  assert.match(js, /readErrorCode/);
  assert.match(js, /body\.message\.code/);
});

test('accessibility: polite live status, semantic headings, focus move, labels', () => {
  assert.match(js, /'aria-live', 'polite'/);
  assert.match(js, /role', 'status'/);
  assert.match(js, /aria-atomic/);
  assert.match(js, /data-autofocus/);
  assert.match(js, /\.focus\(\)/);
  assert.match(js, /headingNode\('h1'/);
  assert.match(js, /headingNode\('h2'/);
  assert.match(js, /setAttribute\('aria-label'/);
  assert.match(js, /createElement\('label'\)|node\(selectable \? 'label'/);
});

test('stylesheet is isolated, mobile-first, 44px targets, safe-area and reduced motion', () => {
  const classes = css.match(/\.[A-Za-z][\w-]*/g) ?? [];
  assert.ok(classes.length > 20, 'stylesheet has class selectors');
  for (const token of classes) {
    assert.ok(token.startsWith('.phab-rc-'), 'isolated class namespace: ' + token);
  }
  assert.doesNotMatch(css, /(^|\n)\s*(body|html|#)[\s,{]/);
  assert.doesNotMatch(css, /url\(|https?:\/\//i);
  assert.match(css, /max-width: 520px/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /min-width: 44px/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /position: sticky/);
  assert.match(css, /object-fit: cover/);
  assert.match(css, /@media \(min-width: 560px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /phab-rc-status-active/);
  assert.match(css, /phab-rc-status-expiring/);
  assert.match(css, /phab-rc-status-expired/);
  assert.match(css, /phab-rc-demo-badge/);
  assert.match(css, /phab-rc-permission-notice/);
});
