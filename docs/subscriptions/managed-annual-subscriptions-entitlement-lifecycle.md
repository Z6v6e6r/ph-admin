# Managed annual subscriptions: entitlement lifecycle

Status: **checkpoint candidate / default off / no provider pricing activation**.

This component turns an eligible server-side quote into an atomic subscription-benefit
reservation. It does not call Viva, create a booking, create a payment transaction, deploy, or
enable enforcement. The LK adapter must confirm or release the reservation after its own exact
provider read-back.

## Enablement

The mutation boundary has a dedicated token and a separate default-off flag:

```dotenv
SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED=true
SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED=true
SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED=true
SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED=true
SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED=true
SUBSCRIPTIONS_ENTITLEMENT_INTEGRATION_TOKEN=<dedicated-at-least-32-bytes>
```

The read-only shadow token is not accepted by entitlement mutations. Every request also requires
the client's verified LK Bearer identity. Missing, mismatched, or stale identity/target/policy/
aggregate evidence fails closed.

## Internal API

- `POST /api/internal/subscriptions/entitlements/reserve`
  requires `Idempotency-Key`, re-evaluates the trusted server target, and commits aggregate CAS,
  BOOKING operation, `ENTITLEMENT_RESERVED` ledger event, and outbox row in one Mongo transaction.
- `POST /api/internal/subscriptions/entitlements/confirm`
  binds the reservation to one exact `providerBookingId`, marks the active service confirmed, and
  appends `BOOKING_CONFIRMED` plus outbox atomically.
- `POST /api/internal/subscriptions/entitlements/release`
  reverses the exact stored counter deltas. A confirmed reservation can be released only with the
  matching provider booking id and `BOOKING_CANCELLED` reason. A provider rejection before booking
  confirmation can release without a booking id. In strict mode it still requires signed owner
  evidence of a definite provider rejection; a timeout is not a rejection.

Each active reservation stores its exact local day/week/month keys and deltas so rollback never
recomputes historical policy. Legacy reservations without this evidence fail closed to manual
reconciliation.

## Read-only JOIN preflight

`POST /api/internal/subscriptions/entitlements/preflight` accepts exactly:

```json
{
  "subscriptionInstanceId": "subscription:annual-1",
  "action": "JOIN_GAME",
  "target": { "targetId": "exercise:game-1" }
}
```

It uses the existing entitlement integration token, verified actor Bearer and closed runtime,
trusted-adapter, canonical-target, shadow-quote and reservation flags. No new flag or credential
is introduced. `CREATE_GAME`, caller policy/snapshot/usage claims, extra fields and malformed IDs
are rejected. Direct service calls enforce the same shape as the HTTP DTO.

The exact success body is `{schemaVersion: 1, nonBinding: true, subscriptionInstanceId, action,
target: {targetId}, expectations}`; `expectations` has the schema-version-1 shape below. Every
reference comes from the current server-resolved canonical target and actor-owned instance's
effective published policy. It is returned only for an eligible quote or the existing explicit
full-price fallback rule. Missing/stale/foreign/malformed inputs fail closed. The response does
not add identity hashes, provider client/subscription identity fields, monetary fields, usage
references, or a new expiry. The internal target reference must remain backend-only; the planned
LK consumer binds it to the owner-resolved provider exercise.

The service resolves authenticated context and calls `connectReadOnly` and the quote evaluator
directly. It never calls the HTTP shadow-quote handler, whose journal would write. It performs
no reservation, operation/ledger/outbox change, index creation, quote journal, admin mutation audit
or provider business API/write request. Existing Bearer verification may refresh its configured
JWKS over a read-only HTTP request on a cache miss. The endpoint carries `no-store` and
`no-referrer`; metrics use only the two fixed route templates, without request/response bodies or query values. Existing HTTP exception
envelopes apply: validation is `VALIDATION_ERROR`, blocked policy is `POLICY_VERSION_CONFLICT`,
unavailable authoritative input is `UPSTREAM_UNAVAILABLE`; domain codes remain in
`error.details.domainCode`. Anonymous invalid credentials retain the existing `AUTH_REQUIRED` mapping.

Preflight is not authorization, a reservation or a v2 owner receipt. Policy/target may change after
it returns; reserve must submit these expectations and pass the version checks below. Do not retry
without expectations to bypass a mismatch. The intended consumer is the separate LK managed JOIN
flow using its already server-owned exercise mapping; provider identifiers must not be forwarded
directly to a public client. Runtime station/target mapping facts remain unverified, provider
acceptance is absent, and this source addition authorizes no activation. Deploy the receiver before
an opt-in consumer; stop that consumer before rolling back this endpoint.

## Optional reserve expectations (schema version 1)

An internal caller may add `expectations` to the existing reserve body:

```json
{
  "subscriptionInstanceId": "subscription:annual-1",
  "action": "CREATE_GAME",
  "target": { "targetId": "exercise:game-1" },
  "expectations": {
    "schemaVersion": 1,
    "policyVersion": 3,
    "policyDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "targetSnapshot": {
      "snapshotId": "snapshot:target-1",
      "revision": 1,
      "evidenceRef": "evidence:target-1"
    }
  }
}
```

This is a precondition, not client authority. The verified actor and tenant still come from
existing authentication. The outer instance/action/target and all expectation fields enter a
separate domain/version fingerprint. Unknown fields, null, noninteger or unsafe versions and
malformed identifiers/digests are rejected, including at the service boundary. Missing
`expectations` preserves the original request hash, resolution order and legacy behavior.
The reserve response is unchanged; this does not introduce a v2 owner receipt or activate a consumer.

After authentication, a tenant/actor-scoped existing BOOKING with the identical fingerprint
replays its stored decision before consulting the current target or policy. Every bound replay,
including a concurrent replay returned by the transaction, must also match stored CLIENT actor,
tenant, instance, key hash and immutable decision policy/action/target. Invalid stored bindings
cannot return a successful replay even with a matching fingerprint. Changed expectations
under that key return `SUBSCRIPTION_ENTITLEMENT_IDEMPOTENCY_CONFLICT`. Existing terminal-state
replay restrictions still apply. An unchanged active replay therefore survives later policy
republishing or target supersession without reserving again.

For a new operation, the resolver supplies the stored canonical snapshot ID, revision and evidence;
request fields are never echoed as evidence. The quote resolves the actor-owned instance's
published policy version/digest. All must match before reservation persistence or a full-price
fallback, otherwise the service raises `SUBSCRIPTION_ENTITLEMENT_EXPECTATION_MISMATCH` (409).
The existing HTTP filter preserves this under `error.details.domainCode`, with top-level
`error.code=POLICY_VERSION_CONFLICT`; the same envelope applies to idempotency/state conflicts.
Invalid HTTP DTO shape uses `VALIDATION_ERROR`; direct service calls raise
`SUBSCRIPTION_ENTITLEMENT_EXPECTATIONS_INVALID` (400). Comparisons rerun after aggregate CAS
contention. Effective policy means the instance-pinned publication: publishing an unrelated newer
version does not invalidate an instance still validly pinned to the earlier version.

This comparison guarantees matching authoritative inputs **at resolution**, not latest-at-commit
policy/target atomicity. Existing Mongo transactions fence aggregate revision and idempotency and
atomically persist operation/usage/outbox; they do not reread or lock policy or target publications.
No new schema, ledger or cross-provider transaction is introduced. The stable `booking:<hash>`
operation remains the canonical reference; no pre-issued usage reference or expiry is added.
Deployment of the receiver must precede any opt-in caller: an older receiver rejects the new field.
Rollback requires stopping such callers first; never strip expectations and silently retry an
expected request through the legacy path. Existing reservations still use normal confirm/release.
Runtime station/target mapping, owner-v2 receipt adoption and provider acceptance remain separate
release gates. No flags, credentials or provider writes are changed here.

## Owner evidence for release (R1)

`SUBSCRIPTIONS_OWNER_EVIDENCE_STRICT=true` now applies to both confirmation and release,
including successful replays. The existing confirmation `v1` wire bytes are unchanged.
Release uses the same backend-only configured secret and age limit, but a separate HMAC domain:

- Header: `x-subscription-owner-evidence`.
- Token: `release-v1.<base64url(payload)>.<lowercase-hex-HMAC-SHA256>`.
- HMAC input: `owner-evidence:release:v1` + one NUL byte + the encoded payload.
- Exact compact JSON fields, in order: `operationId`, `reason`, `providerBookingId`, `issuedAt`.
- `reason` is `BOOKING_CANCELLED` (requires the exact nonempty booking id) or
  `PROVIDER_REJECTED` (requires explicit JSON `null` for the booking id).
- IDs follow `[A-Za-z0-9][A-Za-z0-9._:-]{2,199}`; `issuedAt` is canonical ISO UTC with
  milliseconds. Extra/duplicate keys or noncanonical payload encodings are rejected.
- The configured max age defaults to 60 seconds (allowed 10–300); future skew is limited to
  60 seconds. Missing key configuration returns 503; absent/invalid proof returns 403 before
  mutation. A replay requires a fresh proof for the same completed release.

The `createOwnerReleaseEvidence` helper is an internal producer primitive, not a public
signing endpoint. Only the canonical booking owner may issue the proof, after exact provider
cancellation readback or a definite rejection establishing that no booking was created. This
change does not add an LK signer or assert provider readback. Owner integration and sandbox
acceptance remain required before enabling strict mode for real traffic. No secret is created
or changed by this source change.

Strict-off preserves unsigned legacy requests. In both modes, terminal release replay must
match the stored reason and provider booking id and a completed compensation; mismatch returns
`SUBSCRIPTION_ENTITLEMENT_RELEASE_EVIDENCE_MISMATCH` without touching counters, ledger or outbox.
The existing aggregate/operation CAS and transaction remain the only write path. A valid repeat
returns the original terminal state without a second counter restoration or ledger event.

No migration or new collection is needed: the completed reason and booking already exist in
`lastReconciliationResult` and `providerCorrelationId`. Historical terminal rows with mismatched release evidence or incomplete compensation
fail closed and need owner reconciliation, not automatic repair. Rollback is a reviewed code
rollback; do not disable strict proof validation merely to clear a denied compensation.

## Full-price fallback

If and only if the sole blocker is `ACTIVE_SERVICES_LIMIT_REACHED`, reserve returns
`FULL_PRICE_WITHOUT_SUBSCRIPTION` and performs no write. The caller may continue through its
ordinary full-price path. Policy, ownership, station, target, price-evidence, expiry, and other
blockers never degrade to full-price implicitly.

## Concurrency and recovery

Aggregate and operation revisions are CAS-protected. Up to three fresh quote/CAS attempts are
allowed; continued contention returns a retryable revision conflict. Idempotent replay must match
the original request hash. Operation, aggregate, ledger, and outbox changes share the same
majority-journaled transaction.

Recovery is disabling `SUBSCRIPTIONS_ENTITLEMENT_RESERVATION_ENABLED`. Existing reservations must
still be reconciled before disabling the confirmer/releaser in an activated environment.

The remaining activation gate is the exact Viva provider contract for mixed pricing, including
the 60-minute subscription benefit plus a discounted 30/60-minute overage. Until that contract is
captured and tested, the LK production adapter must not route discounted payment writes here.

## Physical Mongo regression evidence (R1)

`npm run test:subscriptions-entitlement-lifecycle:mongo` runs the canonical lifecycle service
against independent `SubscriptionsRepository` Mongo clients. The suite requires the explicit
`SUBSCRIPTIONS_ENTITLEMENT_MONGODB_TEST_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0`
(or another loopback port); missing, credential-bearing, non-loopback or database-qualified URIs
fail before connection. Every client URI is normalized to `directConnection=true`, including
repository and child-process connections, so replica-set discovery cannot follow a remotely
advertised primary. Conflicting or additional URI options are rejected. It creates and removes only its own uniquely named
`phab_entitlement_ci_<pid>_<uuid>` synthetic database. The existing binding-promotion CI job supplies
its disposable replica set; the suite does not provision infrastructure. Before repository
connections, the existing guarded index installer initializes this empty fixture database with
its exact URI/database fingerprint. Repository startup remains verify-only for runtime indexes;
`SUBSCRIPTIONS_AUTO_CREATE_INDEXES` does not create those runtime prerequisites.

The scenarios synchronize four last-unit/max-one reservations at the same stored aggregate
revision, check same-key replay and unchanged persistence on invalid owner/tenant/actor evidence,
and align confirmation/release contenders at the repository entry before the first write. They
verify one ledger/outbox event per transition with exact counter restoration. A duplicate outbox key forces the final insert to fail after operation, aggregate
and ledger writes, checking whole-transaction rollback. After removing only that fault fixture,
a response is deliberately lost after a real committed release; a separate Node process retries
and verifies the persisted ledger, outbox and counters remain unchanged. Identity, policy quote,
clock and lost response are synthetic; persistence, sessions, transactions and unique indexes
are real. No provider is called.

A passing execution is **CI** evidence for this persistence boundary, not HTTP E2E, provider,
STAGING or PRODUCTION acceptance. Adding the test alone is not a claim of physical execution;
attach the successful CI run to the release evidence before closing the persistence gate.

## Read-only release recovery after an acknowledgement is lost

`POST /api/internal/subscriptions/entitlements/readback` accepts exactly
`{ operationId, subscriptionInstanceId }` using the existing identifier rules. The request requires
the existing verified LK Bearer and dedicated `X-Subscriptions-Integration-Token`;
`X-Correlation-ID` is optional. The entitlement reservation, trusted adapter and runtime contract
flags must still be enabled. No owner proof or idempotency key is consumed or issued.

The HTTP 200 response contains only:

```json
{
  "schemaVersion": 1,
  "operationId": "booking:example",
  "subscriptionInstanceId": "subscription:example",
  "operationState": "FAILED",
  "compensationState": "APPLIED",
  "releaseReason": "PROVIDER_REJECTED",
  "providerBookingId": null
}
```

`releaseReason` is `PROVIDER_REJECTED`, `BOOKING_CANCELLED`, or `null`; it never exposes arbitrary
reconciliation text. The route skips mutation audit, sends `no-store`/`no-referrer`, opens the
repository in verify-only mode, and reads one operation on the primary with majority read concern.
The lookup binds operation, subscription instance, tenant, CLIENT actor/hash and BOOKING kind.
Missing or foreign matches return the same 404. Malformed stored operations fail closed with 503.
The current error envelope is unchanged, including anonymous entitlement-token rejection mapping
to HTTP 401 `AUTH_REQUIRED`.

This read does not refresh the 60-second owner proof, retry release, call a provider, or change an
operation, aggregate, ledger, outbox or index. A confirmed provider rejection whose release
committed but lost its response can therefore be observed after proof expiry. The LK consumer
may finalize only its exact pinned operation/instance marker after the exact
`FAILED / APPLIED / PROVIDER_REJECTED / null` response; every other state remains pending.
No new signer or write authorization is implied by a readback.

The physical Mongo suite adds a committed provider-rejection release with a lost response, moves
the synthetic clock beyond proof TTL, confirms the old proof is rejected, and checks that readback
returns the minimal state while all four business collections stay identical. This new scenario
requires its own successful CI run; prior lifecycle CI results do not prove the added readback.
Identity and quote policy remain synthetic, and provider/STAGING/PRODUCTION acceptance is separate.
