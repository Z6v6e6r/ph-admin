import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const flow = JSON.parse(
  readFileSync(new URL('../node-red/lk-academy-support-ingest-flow.json', import.meta.url), 'utf8')
);

// Execute the committed function bodies and actual wires, never a rewritten normalizer.
// HTTP is a deferred synthetic boundary: no socket, provider, database or secret access.
function createFlowHarness() {
  const nodes = new Map(flow.map((node) => [node.id, node]));
  const responses = [];
  const requests = [];
  const diagnostics = [];
  const environment = {
    SUPPORT_API_BASE_URL: 'http://synthetic.invalid/api',
    SUPPORT_INTEGRATION_TOKEN: 'synthetic-integration-token'
  };
  function cloneMessage(message) {
    const { req, res, ...fields } = message;
    return { ...structuredClone(fields), req, res };
  }
  function send(node, message, output = 0) {
    for (const target of node.wires?.[output] ?? []) execute(nodes.get(target), cloneMessage(message));
  }
  function execute(node, message) {
    assert.ok(node, 'Every flow wire must target a known node');
    if (node.type === 'debug') return;
    if (node.type === 'http response') {
      responses.push(cloneMessage(message));
      return;
    }
    if (node.type === 'http request') {
      requests.push({ node, message: cloneMessage(message) });
      return;
    }
    if (node.type === 'function') {
      const api = {
        warn: (value) => diagnostics.push(value),
        log: (value) => diagnostics.push(value),
        error: (value) => diagnostics.push(value)
      };
      const result = new Function('msg', 'env', 'node', node.func)(
        message,
        { get: (key) => environment[key] },
        api
      );
      if (Array.isArray(result)) {
        result.forEach((value, output) => {
          if (value) send(node, value, output);
        });
      } else if (result) send(node, result);
      return;
    }
    assert.ok(node.type === 'http in' || node.type === 'catch');
    send(node, message);
  }
  return {
    responses,
    requests,
    diagnostics,
    receive(payload) {
      const ingress = flow.find(
        (node) => node.type === 'http in' && node.url === '/integrations/lk-academy/webhook'
      );
      const request = { headers: {} };
      const response = {};
      execute(ingress, { payload, req: request, res: response });
      return { request, response };
    },
    completeSupport(index, statusCode, payload) {
      const { node, message } = requests[index];
      send(node, { ...message, statusCode, payload });
    },
    failSupport(index) {
      const { node, message } = requests[index];
      assert.equal(node.senderr, true, 'Transport errors must be routed to the scoped Catch');
      const catcher = flow.find((candidate) => candidate.type === 'catch' && candidate.scope?.includes(node.id));
      assert.ok(catcher, 'The HTTP request needs its own Catch route');
      execute(catcher, { ...message, error: { message: 'synthetic-private-network-diagnostic' } });
    }
  };
}

test('Academy webhook does not acknowledge while support ingestion is still pending', () => {
  const harness = createFlowHarness();
  harness.receive({
    externalUserId: 'synthetic-academy-user',
    externalChatId: 'synthetic-academy-chat',
    externalMessageId: 'synthetic-academy-event',
    text: 'Synthetic inbound message'
  });
  assert.equal(harness.requests.length, 1, 'Exactly one downstream ingest request');
  assert.equal(harness.responses.length, 0, 'No successful ACK before downstream completion');
});

test('Academy webhook does not turn support HTTP 503 into a successful ACK', () => {
  const harness = createFlowHarness();
  harness.receive({ externalUserId: 'synthetic-user', text: 'Synthetic message' });
  harness.completeSupport(0, 503, { internalDiagnostic: 'synthetic-private-diagnostic' });
  assert.equal(harness.responses.length, 1);
  assert.equal(harness.responses[0].statusCode, 503);
  assert.equal(harness.responses[0].payload.accepted, false);
  assert.ok(!JSON.stringify(harness.responses).includes('synthetic-private-diagnostic'));
});

test('Academy bridge preserves explicit source event fields without inventing ID aliases', () => {
  const harness = createFlowHarness();
  const event = {
    externalUserId: 'synthetic-user',
    externalMessageId: 'source:Event-001',
    timestamp: '2026-10-21T18:40:12.000Z',
    text: 'Synthetic message'
  };
  harness.receive(event);
  assert.equal(harness.requests[0].message.payload.externalMessageId, event.externalMessageId);
  assert.equal(harness.requests[0].message.payload.timestamp, event.timestamp);
  const other = createFlowHarness();
  other.receive({ externalUserId: 'synthetic-user', id: 'not-an-event-contract', text: 'Synthetic' });
  assert.equal(other.requests[0].message.payload.externalMessageId, undefined);
});

test('invalid Academy payload receives HTTP 400 instead of being silently dropped', () => {
  const harness = createFlowHarness();
  const { request, response } = harness.receive({ text: 'No identity' });
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.responses.length, 1);
  assert.equal(harness.responses[0].statusCode, 400);
  assert.equal(harness.responses[0].payload.accepted, false);
  assert.equal(harness.responses[0].req, request);
  assert.equal(harness.responses[0].res, response);
});

test('support transport failure is bounded and replies without payload diagnostics or retry', () => {
  const harness = createFlowHarness();
  harness.receive({ externalUserId: 'synthetic-user', text: 'Synthetic' });
  assert.equal(harness.requests[0].message.requestTimeout, 8000);
  assert.equal(harness.requests[0].message.followRedirects, false);
  harness.failSupport(0);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.responses.length, 1);
  assert.equal(harness.responses[0].statusCode, 503);
  assert.equal(harness.responses[0].payload.accepted, false);
  assert.ok(!JSON.stringify(harness.responses[0].payload).includes('synthetic-private'));
});

test('full Academy payload and result debug output is disabled', () => {
  for (const node of flow.filter((node) => node.type === 'debug')) assert.equal(node.active, false);
});

test('valid support response confirms forwarding but never invents durable custody', () => {
  const harness = createFlowHarness();
  const { request, response } = harness.receive({ externalUserId: 'synthetic-user', text: 'Synthetic' });
  harness.completeSupport(0, 201, { client: { id: 'synthetic-client' }, dialog: { id: 'synthetic-dialog' } });
  assert.equal(harness.responses.length, 1);
  assert.equal(harness.responses[0].statusCode, 200);
  assert.deepEqual(harness.responses[0].payload, { ok: true, accepted: true, persistenceConfirmed: false });
  assert.equal(harness.responses[0].req, request);
  assert.equal(harness.responses[0].res, response);
  assert.equal(harness.responses[0].headers['Cache-Control'], 'no-store');
});

for (const payload of ['<html>proxy error</html>', {}, { client: {}, dialog: {} }]) {
  test('malformed support 2xx cannot confirm ingestion: ' + JSON.stringify(payload), () => {
    const harness = createFlowHarness();
    harness.receive({ externalUserId: 'synthetic-user', text: 'Synthetic' });
    harness.completeSupport(0, 200, payload);
    assert.equal(harness.responses[0].statusCode, 502);
    assert.equal(harness.responses[0].payload.accepted, false);
  });
}
