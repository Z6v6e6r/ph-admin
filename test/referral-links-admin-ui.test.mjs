import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../client-sdk/phab-referral-links-admin.js', import.meta.url), 'utf8');
const controllerSource = readFileSync(new URL('../src/referral-links/referral-links.controller.ts', import.meta.url), 'utf8');

test('referral links UI exposes requested fields and states', () => {
  for (const marker of [
    'Кому выдали',
    'На какую страницу',
    'Начало акции',
    'Конец акции',
    'Ежедневная статистика',
    'Перешли к покупке',
    'Не купили',
    'Выгрузить CSV'
  ]) assert.match(source, new RegExp(marker));
});

test('referral links UI does not render full phone field', () => {
  assert.match(source, /clientPhoneMasked/);
  assert.doesNotMatch(source, /row\.clientPhone(?:\W|$)/);
  assert.match(source, /subscriptions:analytics:read/);
  assert.match(source, /referralLinksAdminEnabled/);
});

test('PII export fails closed when durable audit is unavailable', () => {
  assert.match(controllerSource, /authPersistence\.isEnabled\(\)/);
  assert.match(controllerSource, /REFERRAL_LINK_EXPORT_AUDIT_UNAVAILABLE/);
  assert.doesNotMatch(controllerSource, /appendAudit\([\s\S]*?\)\.catch\(/);
});
