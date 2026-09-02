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
6. exactly one sale-period policy derived from the instance `purchasedAt` and
   publication `effectiveAt` history, linked by the stored mapping/version/digest;
7. current, fresh subscription-instance reconciliation.

Any missing, stale, disabled or mismatched evidence blocks the request. There is
no fallback to product names or client-supplied subscription instance ids.

## Sale-period resolution

For one subscription type, CUP derives half-open periods from every stored
publication (`PUBLISHED`, `SUPERSEDED`, and disabled):
`[effectiveAt(vN), effectiveAt(vN+1))`; the last period is open-ended. The
instance `purchasedAt` selects the policy. A purchase exactly at a newer
`effectiveAt` selects that newer policy. Before the first period, malformed
timestamps, duplicate starts, or any result other than exactly one match fail
closed. A disabled publication is never silently skipped or accepted as the
selected policy. Runtime-context never uses the current date to select or
re-pin a policy. Explicit publication `until` values are not a supported
contract; the next `effectiveAt` is the exclusive end of a period.

The complete history must also be a canonical lifecycle chain: the chronological
tail is the only `PUBLISHED` row, and every earlier row is `SUPERSEDED` with
`supersededBy` pointing to the next publication and
`supersededAt` equal to that successor's `publishedAt`. The projector binding
must identify that current tail. Multiple current rows, broken links, disabled
rows inside the chain, or a later publication after the bound row fail closed.

## Provider instance projection pins

The production provider projector preserves its strict
`VIVA_AUTHORITATIVE_COMPLETE_SUBSCRIPTION_INSTANCE_SNAPSHOT` contract. Its
manifest binding coordinates the current mapping, publication fence, release
program and phase; it no longer assigns that current publication to every row.
For each validated provider record the projector resolves `purchasedAt` against
the complete stored publication history and pins the resulting
`policyVersion`, `policyDigest` and `mappingId` on that instance.

New checkpoints use schema version 3. They retain the current fence binding and
add a digest of the complete validated publication documents, canonical
publication evidence, and one resolution record per instance with its provider
identity, `purchasedAt`, publication id, version, digest and mapping. The plan
digest includes the instances and checkpoint, so it commits to every selected
policy as well as the current fence revision and digest.

Schema-v2 checkpoints remain readable, but cannot be an exact replay of a
schema-v3 multi-period plan. Apply rereads and compares the complete publication
history inside the same Mongo snapshot transaction before the fence CAS or any
insert. History/fence drift, a disabled selected publication, a pin mismatch,
or an old conflicting checkpoint produces zero partial writes.

The production CLI exposes a read-only planning step after the input and target
fingerprints. `plan-fingerprint` opens only a read-only repository connection,
loads the attested publication history and persisted binding, verifies that
the history and fence remain stable, and emits the sanitized history-bound plan
digest with `write: false`. It deliberately does not require
`SUBSCRIPTIONS_INSTANCE_PROJECTOR_PLAN_SHA256`; that emitted digest is then
supplied to `check` and `apply` as the independent plan attestation.

```text
npm run subscriptions:instance-projector:input-fingerprint
npm run subscriptions:instance-projector:target-fingerprint
npm run subscriptions:instance-projector:plan-fingerprint
npm run subscriptions:instance-projector:check
npm run subscriptions:instance-projector:apply
```

## Isolated DEV exact-two canary

`scripts/managed-subscriptions-instance-projector-dev-canary.ts` is a standalone
operator CLI with no HTTP route, startup hook or scheduler and no Viva calls. It
accepts a private exact-shape input with source contract
`DEV_VIVA_EXACT_CLIENT_SUBSCRIPTION_ALLOWLIST`, exactly two allowlisted
`clientSubscriptionId` values and matching records. It uses the same plan
builder, sale-period resolver and policy pins as production, but writes only to
`subscription_instance_dev_canary_*` collections with
`EXACT_ALLOWLIST_CANARY` coverage; this cannot satisfy the production complete
snapshot contract.

The CLI requires `NODE_ENV=development|test`, a credential-free loopback Mongo
URI, a `dev-*` or `test-*` database, a non-production DEV/TEST service marker,
disabled auto-index creation, a credential-free target fingerprint and the
exact apply phrase `APPLY_EXACTLY_TWO_DEV_SUBSCRIPTION_INSTANCES`. All guards run
before connection. Deterministic `_id` custody, a snapshot transaction and an
in-transaction publication-history reread protect concurrent apply and drift.
Output contains only status, counts and digests.

```text
npm run subscriptions:instance-projector:dev-canary:target-fingerprint
npm run subscriptions:instance-projector:dev-canary:plan-fingerprint
npm run subscriptions:instance-projector:dev-canary:check
npm run subscriptions:instance-projector:dev-canary:apply
```

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
