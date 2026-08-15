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
  assert.doesNotMatch(source, /data-subscriptions-panel="instances"[\s\S]{0,500}>0 активн/);
}

testDisabledPageIsNotServed();
testPageIsExplicitlyFakeAndUsesOnlyTestRuntimeRoutes();
testAdminSubscriptionSectionsAndRuntimeControlsAreExplicit();
console.log('Subscription test runtime UI safety tests passed');
