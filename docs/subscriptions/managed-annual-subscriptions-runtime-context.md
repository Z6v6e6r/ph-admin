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
- HUB exact `STATION_LIST` pinned to the reviewed 25-station Viva dictionary snapshot;
- disabled active/weekly/monthly/future/min-interval counters for the first
  activation.

For Piter and HUB the catalog lifecycle may use
`FIRST_USE_OR_FIXED_DATE` with `activationWindowDays=0`,
`fixedActivationAt=2026-09-30T21:00:00.000Z` and
`fixedActivationTimeZone=Europe/Moscow`. The additive runtime projection carries
that mode, deadline and `validityDays=365`; legacy schema-v1 projections without
those optional lifecycle fields remain readable.

This projection does not activate a `SubscriptionInstance`. The isolated
activation candidate adds a separate provider-confirmed command and a durable
deadline worker; both are disabled by default and remain independent release,
index, secret-provisioning and enablement gates. A `PENDING_ACTIVATION` instance
is never converted to `ACTIVE` by this read-only runtime-context endpoint.

## Isolated activation candidate

After LK has read back the exact Viva booking, its server-side gateway may call:

```http
POST /api/internal/subscriptions/activate-first-use
Authorization: Bearer <same verified LK user token>
X-Subscriptions-Integration-Token: <separate activation token>
X-Correlation-Id: <stable LK operation id>

{
  "subscriptionInstanceId":"<exact CUP instance>",
  "clientSubscriptionId":"<exact Viva client subscription>",
  "providerBookingId":"<exact Viva booking>",
  "expectedInstanceRevision":1
}
```

CUP re-verifies tenant/client ownership, mapping/publication/instance freshness
and the exact lifecycle. One Mongo transaction performs the revision-CAS state
change, immutable `ACTIVATION` operation, `INSTANCE_ACTIVATED` ledger event and
outbox append. A replay returns `ALREADY_ACTIVE`; a revision conflict never
overwrites a newer state.

The optional deadline worker scans only `PENDING_ACTIVATION` instances. It
activates at `2026-09-30T21:00:00.000Z` only when the stored provider-instance
evidence exists and reconciliation proves a provider read-back at or after the
deadline. Missing/stale evidence increments a sanitized failure metric and
leaves the instance pending for a later pass.

Candidate-only configuration (all flags remain off until separate approval):

```text
SUBSCRIPTIONS_ACTIVATION_ENABLED=true
SUBSCRIPTIONS_ACTIVATION_INTEGRATION_TOKEN=<at least 32 bytes>
SUBSCRIPTIONS_ACTIVATION_MAX_STALENESS_SECONDS=<30..86400>
SUBSCRIPTIONS_ACTIVATION_DEADLINE_WORKER_ENABLED=true
SUBSCRIPTIONS_ACTIVATION_DEADLINE_INTERVAL_MS=<5000..3600000>
SUBSCRIPTIONS_ACTIVATION_DEADLINE_BATCH_SIZE=<1..200>
```

Create 90/120 add-ons, group training and tournament discounts remain closed
until exact Viva prices, product/event ids and discount rules are published.
