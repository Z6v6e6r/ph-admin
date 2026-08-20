# Managed annual subscriptions: LK runtime context

## Purpose and boundary

`POST /api/internal/subscriptions/runtime-context` is the read-only trust bridge
used by the LK booking gateway. It returns an immutable published policy and a
sanitized actor-owned subscription instance for one exact Viva
`clientSubscriptionId`.

The route does not create a subscription, publish a policy, reserve usage,
write Mongo, book Viva or calculate a browser-supplied target. Feature flags are
off by default.

## Request

```http
POST /api/internal/subscriptions/runtime-context
Authorization: Bearer <LK user token>
X-Subscriptions-Integration-Token: <server integration token>
Content-Type: application/json

{"clientSubscriptionId":"<exact Viva client subscription id>"}
```

The user Bearer is verified by `LkIdentityService`. CUP resolves the canonical
provider client id from that identity and performs a tenant + provider client +
client subscription lookup. Unknown and foreign instances share the same 404
response.

## Returned evidence

The response contains:

- `schemaVersion=1`;
- exact `subscriptionInstanceId` and `clientSubscriptionId`;
- `policyDigest` and the stored `runtimeProjection` of a `PUBLISHED` policy;
- only evaluator-safe instance fields (type/version/state/validity/home station);
- mapping, publication and instance revisions/timestamps for audit.

Provider client ids, phone numbers, client hashes, payment evidence and raw
provider payloads are never returned.

## Fail-closed checks

Before returning context CUP requires:

1. enabled runtime contracts and runtime-context adapter;
2. constant-time integration-token match;
3. LK tenant and canonical provider client identity;
4. exact actor ownership hash;
5. verified, fresh provider mapping with matching tenant/product/type/scope;
6. exact `PUBLISHED`, already-effective policy linked by mapping/version/digest;
7. current, fresh subscription-instance reconciliation.

Any missing, stale, disabled or mismatched evidence blocks the request. There is
no fallback to product names or client-supplied subscription instance ids.

## Configuration

```text
SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED=true
SUBSCRIPTIONS_RUNTIME_CONTEXT_ENABLED=true
SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS=<30..86400>
SUBSCRIPTIONS_RUNTIME_CONTEXT_INTEGRATION_TOKEN=<at least 32 bytes>
SUBSCRIPTIONS_RUNTIME_TENANT_ID=<tenant id>
SUBSCRIPTIONS_RUNTIME_HASH_PEPPER=<at least 32 bytes>
```

Enabling flags or provisioning secrets is a separate activation gate. A deploy
with flags off is compatible but cannot authorize managed subscription usage.

## Piter and HUB publication invariants

The first LK-compatible policies must use:

- `dailyUsageLimit=1`;
- usage units `60=1`, `90=1`, `120=1`;
- create enabled only for 60 minutes;
- join enabled for 60 through 120 minutes;
- Piter station list containing
  `1ea77cbf-bc36-49a1-96d6-f35c216a409b`;
- HUB `ALL_STATIONS` (the actual station is still server-resolved in LK);
- disabled active/weekly/monthly/future/min-interval counters for the first
  activation.

For Piter and HUB the catalog lifecycle may use
`FIRST_USE_OR_FIXED_DATE` with `activationWindowDays=0`,
`fixedActivationAt=2026-09-30T21:00:00.000Z` and
`fixedActivationTimeZone=Europe/Moscow`. The additive runtime projection carries
that mode, deadline and `validityDays=365`; legacy schema-v1 projections without
those optional lifecycle fields remain readable.

This projection does not activate a `SubscriptionInstance`. The production
booking handshake, provider-confirmed activation command and durable deadline
worker remain separate fail-closed gates. Until they exist, a
`PENDING_ACTIVATION` instance must not be converted to `ACTIVE` by this read-only
runtime-context endpoint.

Create 90/120 add-ons, group training and tournament discounts remain closed
until exact Viva prices, product/event ids and discount rules are published.
