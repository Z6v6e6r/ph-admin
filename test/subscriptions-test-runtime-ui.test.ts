import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UiController } from '../src/ui/ui.controller';

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function testDisabledPageIsNotServed(): void {
  const original = process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED;
  delete process.env.SUBSCRIPTIONS_TEST_RUNTIME_ENABLED;
  try {
    let statusCode: number | null = null;
    let body: unknown;
    const response = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      send(value: unknown) {
        body = value;
        return this;
      }
    };
    const controller = Object.create(UiController.prototype) as UiController;
    controller.subscriptionTest(response as never);
    assert.equal(statusCode, 404);
    assert.equal(body, 'Subscription test runtime is disabled');
  } finally {
    restoreEnv('SUBSCRIPTIONS_TEST_RUNTIME_ENABLED', original);
  }
}

function testPageIsExplicitlyFakeAndUsesOnlyTestRuntimeRoutes(): void {
  const source = readFileSync(resolve(process.cwd(), 'src/ui/ui.controller.ts'), 'utf8');
  const pageStart = source.indexOf("@Get('subscription-test')");
  const pageEnd = source.indexOf("@Get('americano-lab')", pageStart);
  assert.ok(pageStart >= 0 && pageEnd > pageStart, 'subscription test page source must exist');
  const page = source.slice(pageStart, pageEnd);

  assert.match(page, /FAKE PAYMENT · TEST ONLY/);
  assert.match(page, /Деньги не списываются/);
  assert.match(page, /Viva не вызывается/);
  assert.match(page, /клиентская подписка не выпускается/);
  assert.match(page, /SUBSCRIPTIONS_TEST_RUNTIME_ENABLED/);
  assert.match(page, /role="status" aria-live="polite"/);
  assert.match(page, /window\.location\.hash/);
  assert.doesNotMatch(page, /window\.location\.search/);
  assert.match(page, /fragment\.get\('offerId'\)/);
  assert.match(page, /fragment\.get\('token'\)/);
  assert.match(page, /\/api\/v1\/subscription-test\/offers\//);
  assert.match(page, /\/api\/v1\/subscription-test\/purchases\//);
  assert.match(page, /'X-Subscription-Test-Token'/);
  assert.doesNotMatch(page, /encodeURIComponent\(token\)/);
  assert.doesNotMatch(page, /JSON\.stringify\(\{ accessToken:/);
  assert.match(page, /'Idempotency-Key'/);
  assert.match(page, /'X-Correlation-Id'/);
  assert.match(page, /confirmIntents\[outcome\]/);
  assert.match(page, /Referrer-Policy', 'no-referrer'/);
  assert.match(page, /Content-Security-Policy/);
  assert.doesNotMatch(page, /\/api\/v1\/viva\//i);
  assert.doesNotMatch(page, /payment-provider|checkout|acquir/i);
}

function testAdminSubscriptionSectionsAndRuntimeControlsAreExplicit(): void {
  const source = readFileSync(resolve(process.cwd(), 'client-sdk/phab-admin-panel.js'), 'utf8');
  assert.match(source, /data-subscriptions-tab="settings"[^>]*>Настройка подписки/);
  assert.match(source, /data-subscriptions-tab="instances"[^>]*>Список подписок/);
  assert.match(source, /data-subscriptions-tab="analytics"[^>]*>Аналитика/);
  assert.match(source, /data-subscription-active-limit-enabled/);
  assert.match(source, /data-subscription-booking-window-enabled/);
  assert.match(source, /data-subscription-station-rule-add/);
  assert.match(source, /PARTIAL_PRICE_PERCENT_DISCOUNT/);
  assert.match(source, /PURCHASE_ADD_ON_PRODUCT/);
  assert.match(source, /No-show — подтверждённая неявка клиента/);
  assert.match(source, /Источник экземпляров пока не подключён/);
  assert.match(source, /Метрики недоступны до подключения append-only ledger/);
  assert.match(source, /Отсутствующие данные обозначаются «недоступно», а не нулём/);
  assert.match(source, /phab-subscriptions-card-head/);
  assert.match(source, /aria-controls="phab-subscription-type-create" data-subscription-type-toggle>\+ Добавить тип/);
  assert.match(source, /id="phab-subscription-type-create"[^>]+data-subscription-type-form/);
  assert.match(source, /phab-subscriptions-type-create phab-admin-hidden/);
  assert.match(source, /<h3>Настройка подписки<\/h3>/);
  assert.doesNotMatch(source, /Одна неизменяемая версия-кандидат/);
  assert.match(source, /data-subscription-booking-window>[\s\S]*?<option>1<\/option>[\s\S]*?<option>14<\/option>/);
  assert.ok(
    source.indexOf('<span>Присоединение к играм</span>')
      < source.indexOf('<span>Разрешённый диапазон длительности</span>')
  );
  assert.match(source, /renderSubscriptionTypeOptions/);
  assert.match(source, /Math\.min\(4, state\.subscriptions\.types\.length\)/);
  assert.match(source, /policySummaryFailures\.push\(type\.subscriptionTypeId\)/);
  assert.match(source, /state\.subscriptions\.loadGeneration !== loadGeneration/);
  assert.doesNotMatch(source, /policyVersionsByType = Object\.create\(null\);\s*var nextPolicyTypeIndex/);
  assert.match(source, /cachedSummaryState\.status === 'READY'/);
  assert.match(source, /Date\.now\(\) - Number\(cachedSummaryState\.fetchedAt \|\| 0\) < 60000/);
  assert.match(source, /\? 'STALE' : 'UNAVAILABLE'/);
  assert.match(source, /Сводка правил недоступна/);
  assert.match(source, /Правил станций:/);
  assert.match(source, /rule && rule\.enabled && rule\.kind !== 'DISABLED'/);
  assert.match(source, /else dom\.subscriptionTypeToggleBtn\.focus\(\)/);
  assert.match(source, /async function loadSubscriptionPolicyVersionsForType/);
  assert.match(source, /subscriptionPolicyTypeInput\.addEventListener\('change'/);
  assert.match(source, /state\.subscriptions\.lastPolicy = versions\.slice\(\)\.sort/);
  assert.doesNotMatch(source, /data-subscriptions-panel="instances"[\s\S]{0,500}>0 активн/);
}

function testSubscriptionBenefitsUseSingleRowLayout(): void {
  const source = readFileSync(resolve(process.cwd(), 'client-sdk/phab-admin-panel.js'), 'utf8');
  assert.match(source, /\.phab-subscriptions-benefits\{display:flex;flex-direction:column;gap:0;grid-column:1\/-1\}/);
  assert.match(source, /\.phab-subscriptions-benefit-main-grid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:7px\}/);
  assert.match(source, /\.phab-subscriptions-benefit-ids-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:7px;margin-top:6px\}/);
  assert.match(source, /\.phab-subscriptions-benefit-fraction\{display:grid;grid-template-columns:minmax\(0,1fr\)\s+auto\s+minmax\(0,1fr\);gap:6px;align-items:center;white-space:nowrap;min-width:0\}/);
  assert.match(source, /\.phab-subscriptions-benefit-fraction \.phab-admin-input\{min-width:0\}/);
  assert.match(source, /@media \(max-width:640px\)\{[\s\S]*?\.phab-subscriptions-benefit-main-grid\{[\s\S]*?grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(source, /@media \(max-width:640px\)\{[\s\S]*?\.phab-subscriptions-benefit-ids-grid\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(source, /data-benefit-remove[^>]*aria-label="Удалить льготу"|aria-label="Удалить льготу"[^>]*data-benefit-remove/);
  assert.match(source, /<span>Доля цены<\/span><div class="phab-subscriptions-benefit-fraction">[\s\S]*?data-benefit-partial-numerator[\s\S]*?data-benefit-partial-denominator/);
  assert.doesNotMatch(source, /\.phab-subscriptions-benefits\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(source, /\.phab-subscriptions-benefit-grid\{[^}]*grid-template-columns:1fr 1fr/);
  assert.doesNotMatch(source, /\.phab-subscriptions-benefit\{[^}]*background:rgba\(248,246,249,.75\)/);
}

testDisabledPageIsNotServed();
testPageIsExplicitlyFakeAndUsesOnlyTestRuntimeRoutes();
testAdminSubscriptionSectionsAndRuntimeControlsAreExplicit();
testSubscriptionBenefitsUseSingleRowLayout();
console.log('Subscription test runtime UI safety tests passed');
