import * as assert from 'node:assert/strict';
import { SubscriptionActivationDeadlineWorker } from
  '../src/subscriptions/subscription-activation-deadline.worker';

const ENV_NAMES = [
  'SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED',
  'SUBSCRIPTIONS_ACTIVATION_DEADLINE_INTERVAL_MS',
  'SUBSCRIPTIONS_ACTIVATION_DEADLINE_BATCH_SIZE'
] as const;
const originals = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

async function main(): Promise<void> {
  process.env.SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED = 'true';
  process.env.SUBSCRIPTIONS_ACTIVATION_DEADLINE_INTERVAL_MS = '5000';
  process.env.SUBSCRIPTIONS_ACTIVATION_DEADLINE_BATCH_SIZE = '2';

  const pages = new Map<string | null, Array<{ subscriptionInstanceId: string }>>([
    [null, [
      { subscriptionInstanceId: 'subscription_instance:due' },
      { subscriptionInstanceId: 'subscription_instance:not-due' }
    ]],
    ['subscription_instance:not-due', [
      { subscriptionInstanceId: 'subscription_instance:replayed' },
      { subscriptionInstanceId: 'subscription_instance:failed' }
    ]],
    ['subscription_instance:failed', []]
  ]);
  const cursors: Array<string | null> = [];
  const repository = {
    connect: async () => undefined,
    runtimePendingActivationInstances: async (cursor: string | null) => {
      cursors.push(cursor);
      return pages.get(cursor) ?? [];
    }
  } as any;
  const activation = {
    activationEnabled: () => true,
    activateFixedDeadline: async (id: string) => {
      if (id.endsWith(':not-due')) return null;
      if (id.endsWith(':failed')) throw new Error('provider read-back unavailable');
      return {
        outcome: id.endsWith(':replayed') ? 'ALREADY_ACTIVE' : 'ACTIVATED'
      };
    }
  } as any;
  const worker = new SubscriptionActivationDeadlineWorker(repository, activation);

  await worker.runCycle();
  assert.deepEqual(worker.metricsSnapshot(), {
    scanned: 2,
    activated: 1,
    replayed: 0,
    notDue: 1,
    failed: 0,
    overlappingCyclesSkipped: 0,
    cursorPending: true
  });
  await worker.runCycle();
  assert.deepEqual(worker.metricsSnapshot(), {
    scanned: 4,
    activated: 1,
    replayed: 1,
    notDue: 1,
    failed: 1,
    overlappingCyclesSkipped: 0,
    cursorPending: true
  });
  await worker.runCycle();
  assert.equal(worker.metricsSnapshot().cursorPending, false);
  assert.deepEqual(cursors, [null, 'subscription_instance:not-due', 'subscription_instance:failed']);

  let releaseScan: (() => void) | undefined;
  repository.runtimePendingActivationInstances = async () => {
    await new Promise<void>((resolve) => { releaseScan = resolve; });
    return [];
  };
  const first = worker.runCycle();
  await Promise.resolve();
  await worker.runCycle();
  assert.equal(worker.metricsSnapshot().overlappingCyclesSkipped, 1);
  releaseScan?.();
  await first;

  process.env.SUBSCRIPTIONS_ACTIVATION_DEADLINE_INTERVAL_MS = '4999';
  assert.throws(
    () => (worker as any).intervalMs(),
    /SUBSCRIPTIONS_ACTIVATION_DEADLINE_INTERVAL_MS is invalid/
  );

  console.log('subscriptions activation deadline worker tests passed');
}

main().finally(() => {
  for (const name of ENV_NAMES) {
    const value = originals.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
