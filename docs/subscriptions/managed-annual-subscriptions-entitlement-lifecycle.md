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
