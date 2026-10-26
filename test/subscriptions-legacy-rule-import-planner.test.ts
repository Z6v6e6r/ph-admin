import * as assert from 'node:assert/strict';
import {
  planLegacyRuleImport,
  renderLegacyRuleImportPlanMarkdown,
  type LegacyRuleInventory,
} from '../src/subscriptions/legacy-rule-import-planner';

function inventory(): LegacyRuleInventory {
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-21T10:59:44+03:00',
    repo: { url: 'https://github.com/Z6v6e6r/lk', sha: '6207cdeb', date: '2026-10-21' },
    products: [
      {
        productId: 'lk1:hub-annual',
        name: 'HUB Annual',
        status: 'ACTIVE',
        vivaProductIds: ['db7a5250-7369-4f43-8ac5-9111be24bc74'],
      },
      {
        productId: 'lk1:friendship-30d',
        name: 'Friendship 30d',
        status: 'ACTIVE',
        vivaProductIds: ['product-a', 'product-b'],
      },
    ],
    rules: [
      {
        ruleId: 'lk1:hub-annual:free-60-min-per-day',
        productId: 'lk1:hub-annual',
        ruleGroup: 'usage_limits',
        value: { freeGameMinutesPerDay: 60 },
        status: 'ACTIVE',
      },
      {
        ruleId: 'lk1:hub-annual:provider-card-365',
        productId: 'lk1:hub-annual',
        ruleGroup: 'subscription_applicability',
        value: { validityDays: 365 },
        status: 'ACTIVE',
      },
      {
        ruleId: 'lk1:hub-annual:missing-provider-id',
        productId: 'lk1:friendship-30d',
        ruleGroup: 'subscription_applicability',
        value: 'product scope',
        status: 'ACTIVE',
      },
      {
        ruleId: 'lk1:friendship-30d:admission',
        productId: 'lk1:friendship-30d',
        ruleGroup: 'player_admission',
        value: 'level admission',
        status: 'UNKNOWN',
      },
      {
        ruleId: 'lk1:hub-annual:unknown-group',
        productId: 'lk1:hub-annual',
        ruleGroup: 'mystery',
        value: 1,
        status: 'ACTIVE',
      },
    ],
    conflicts: [{ ruleIds: ['a', 'b'] }],
    gaps: [],
  };
}

function run(): void {
  const plan = planLegacyRuleImport(inventory(), '2026-10-21T12:00:00.000Z');
  assert.equal(plan.summary.products, 2);
  assert.equal(plan.summary.rules, 5);
  assert.equal(plan.summary.direct, 0);
  assert.equal(plan.summary.partial, 3);
  assert.equal(plan.summary.otherSource, 1);
  assert.equal(plan.summary.unmapped, 1);
  assert.equal(plan.summary.readyProducts, 0);
  assert.equal(plan.conflicts, 1);

  const hub = plan.products.find((product) => product.productId === 'lk1:hub-annual');
  assert.ok(hub);
  assert.equal(hub.providerProductId, 'db7a5250-7369-4f43-8ac5-9111be24bc74');
  assert.equal(hub.readyToPublish, false);
  assert.ok(hub.blockers.includes('INVENTORY_CONFLICTS_PRESENT'));
  assert.ok(hub.blockers.includes('PARTIAL_MAPPING:lk1:hub-annual:free-60-min-per-day'));
  assert.ok(hub.blockers.includes('UNMAPPED_RULE:lk1:hub-annual:unknown-group'));

  const usage = plan.products
    .flatMap((product) => product.mappings)
    .find((mapping) => mapping.ruleId === 'lk1:hub-annual:free-60-min-per-day');
  assert.equal(usage?.cupTarget, 'DAILY_USAGE');
  assert.equal(usage?.status, 'PARTIAL');
  assert.equal(usage?.physicalGroup, 'CUP_POLICY');

  const admission = plan.products
    .flatMap((product) => product.mappings)
    .find((mapping) => mapping.ruleId === 'lk1:friendship-30d:admission');
  assert.equal(admission?.physicalGroup, 'LK2_LEVEL');
  assert.equal(admission?.status, 'OTHER_SOURCE');

  const friendship = plan.products.find((product) => product.productId === 'lk1:friendship-30d');
  assert.equal(friendship?.providerProductId, null);
  assert.ok(friendship?.blockers.includes('PROVIDER_PRODUCT_ID_NOT_UNIQUE'));

  const markdown = renderLegacyRuleImportPlanMarkdown(plan);
  assert.match(markdown, /План переноса действующих правил LK1/);
  assert.match(markdown, /готовы к публикации: 0/);
  assert.match(markdown, /HUB Annual/);
  assert.match(markdown, /DAILY_USAGE \(PARTIAL\)/);

  console.log('subscriptions legacy rule import planner tests: OK');
}

run();
