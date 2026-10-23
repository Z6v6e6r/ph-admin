import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { SubscriptionShadowQuoteJournalService } from '../src/subscriptions/subscription-shadow-quote-journal.service';
import type {
  StoredLk2QuoteDecisionJournalEntry,
  SubscriptionShadowQuoteResult,
} from '../src/subscriptions/subscriptions.types';

const TENANT = '86afbe01-0318-4dd2-bc25-303b7bf0d430';

function result(overrides: Record<string, unknown> = {}): SubscriptionShadowQuoteResult {
  return {
    quoteKind: 'SHADOW',
    nonBinding: true,
    requiresReservationRecheck: true,
    eligible: true,
    blockers: [],
    subscriptionInstanceId: '11111111-1111-4111-8111-111111111111',
    policyVersion: 3,
    policyDigest: `sha256:${'a'.repeat(64)}`,
    aggregateRevision: 2,
    evaluatedAt: '2026-10-21T08:00:00.000Z',
    tenantId: TENANT,
    usageUnits: 1,
    activeServices: 0,
    maxActiveServices: 8,
    dailyUsed: 0,
    dailyLimit: 1,
    benefit: {
      kind: 'FREE_ENTITLEMENT',
      ruleId: 'benefit:join',
      stationRuleId: null,
      basePriceMinor: 300000,
      discountMinor: 300000,
      surchargeMinor: 0,
      finalPriceMinor: 0,
      partialPriceCalculation: null,
    },
    decision: null,
    ...overrides,
  } as unknown as SubscriptionShadowQuoteResult;
}

function repository() {
  const entries: StoredLk2QuoteDecisionJournalEntry[] = [];
  let fail = false;
  return {
    entries,
    setFail: (value: boolean) => {
      fail = value;
    },
    connect: async () => undefined,
    appendLk2QuoteDecision: async (entry: StoredLk2QuoteDecisionJournalEntry) => {
      if (fail) throw new Error('mongo unavailable');
      entries.push(entry);
    },
  };
}

async function testFlagOff(): Promise<void> {
  delete process.env.SUBSCRIPTIONS_LK1_QUOTE_JOURNAL_ENABLED;
  const repo = repository();
  const service = new SubscriptionShadowQuoteJournalService(repo as never);
  const written = await service.journalLk1Quote({
    result: result(),
    action: 'JOIN_GAME',
    targetId: 'exercise:synthetic-1',
    correlationId: 'corr:1',
  });
  assert.equal(written, false);
  assert.equal(repo.entries.length, 0);
}

async function testFlagOn(): Promise<void> {
  process.env.SUBSCRIPTIONS_LK1_QUOTE_JOURNAL_ENABLED = 'true';
  const repo = repository();
  const service = new SubscriptionShadowQuoteJournalService(repo as never);
  const written = await service.journalLk1Quote({
    result: result(),
    action: 'JOIN_GAME',
    targetId: 'exercise:synthetic-1',
    correlationId: 'corr:1',
  });
  assert.equal(written, true);
  assert.equal(repo.entries.length, 1);
  const entry = repo.entries[0]!;
  assert.equal(entry.channel, 'LK1');
  assert.equal(entry.tenantId, TENANT);
  assert.equal(entry.outcome, 'ENTITLEMENT_APPLIED');
  assert.equal(entry.serviceAllowed, true);
  assert.equal(entry.policyVersion, 3);
  assert.equal(entry.targetId, 'exercise:synthetic-1');
  assert.equal(entry.action, 'JOIN_GAME');

  const denied = await service.journalLk1Quote({
    result: result({
      eligible: false,
      blockers: [{ code: 'DAILY_USAGE_LIMIT_REACHED', message: 'limit', details: null }],
    }),
    action: 'JOIN_GAME',
    targetId: 'exercise:synthetic-1',
    correlationId: null,
  });
  assert.equal(denied, true);
  assert.equal(repo.entries[1]?.outcome, 'BENEFIT_UNAVAILABLE');
  assert.deepEqual(repo.entries[1]?.blockers, ['DAILY_USAGE_LIMIT_REACHED']);
  assert.equal(repo.entries[1]?.correlationId, null);
}

async function testSkipAndFailure(): Promise<void> {
  process.env.SUBSCRIPTIONS_LK1_QUOTE_JOURNAL_ENABLED = 'true';
  const repo = repository();
  const service = new SubscriptionShadowQuoteJournalService(repo as never);
  const withoutTenant = await service.journalLk1Quote({
    result: result({ tenantId: undefined }),
    action: 'JOIN_GAME',
    targetId: 'exercise:synthetic-1',
    correlationId: null,
  });
  assert.equal(withoutTenant, false);
  assert.equal(repo.entries.length, 0);

  repo.setFail(true);
  const failed = await service.journalLk1Quote({
    result: result(),
    action: 'JOIN_GAME',
    targetId: 'exercise:synthetic-1',
    correlationId: null,
  });
  assert.equal(failed, false);
  assert.equal(repo.entries.length, 0);
}

async function run(): Promise<void> {
  try {
    await testFlagOff();
    await testFlagOn();
    await testSkipAndFailure();
    console.log('subscriptions LK1 quote journal tests: OK');
  } finally {
    delete process.env.SUBSCRIPTIONS_LK1_QUOTE_JOURNAL_ENABLED;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
