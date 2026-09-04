# Managed annual subscription sale binding

Status: **FLAGS OFF / NO PRODUCTION GO**.

`POST /api/internal/subscriptions/sale-bindings/confirm` is the internal mutation
boundary used after LK has already confirmed both a paid Viva transaction and the exact
Viva client-subscription read-back. It does not create a provider transaction, charge a
client, activate a subscription, publish a policy, or enable runtime use.

## Atomic result

The endpoint first reruns trusted sale readiness and requires the caller's pinned
mapping, publication, projection fence, release program/phase, and projector
reconciliation digest to remain exact. It then validates purchase time against policy
history, the provider home station against the publication and release program, and the
paid minor-RUB amount against the attested phase.

One majority-journaled transaction inserts four linked immutable records:

- the provider-owned `SubscriptionInstance`;
- a CONFIRMED `PURCHASE` runtime operation;
- a `PURCHASE_PAID` usage-ledger event;
- its pending outbox event.

The transaction compares every source snapshot again. Any drift, partial replay, or
identity collision fails closed. The instance ID and evidence references are
server-generated hashes. The public response is sanitized and does not return provider
client/transaction IDs, raw payloads, or evidence references.

## Retry contract

`X-Idempotency-Key`, `X-Correlation-Id`, provider transaction identity, provider
subscription identity, and `providerObservedAt` are required. Generated record times use
the provider observation time, so retrying an unchanged normalized read-back is an exact
replay rather than a second purchase or a conflicting document.

## Configuration and release boundary

```dotenv
SUBSCRIPTIONS_SALE_BINDING_ENABLED=false
SUBSCRIPTIONS_SALE_BINDING_INTEGRATION_TOKEN=
```

The binding token is separate from the read-only sale-readiness token and must contain
at least 32 UTF-8 bytes. Runtime contracts, instance-projector contracts, readiness,
mapping/publication/release evidence, indexes, secret provisioning, deployment, and LK
wiring must all be enabled through their own rollout gates. Source presence alone does
not authorize or prove a production sale.
