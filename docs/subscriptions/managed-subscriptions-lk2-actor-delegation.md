# LK2 actor delegation for Subscription Runtime

Status: source-only, default-off; Mongo replay source/CI evidence required
Date: 2026-08-25

## Boundary

LK2 must not forward its general PadlHub session JWT to `ph-admin`. LK2 instead
mints a request-bound RS256 actor delegation after it has authenticated the user,
resolved the tenant, rechecked the active session and resolved one current
`VIVA/viva_profile` mapping from tenant-scoped PostgreSQL storage.

The internal request uses two independent factors:

- `X-Subscriptions-Integration-Token`: LK2 service identity;
- `X-Subscription-Actor-Delegation`: short-lived actor and request binding.

The LK2-only path is:

`POST /api/internal/subscription-runtime/lk2/v1/quote`.

`Authorization` is forbidden on that path. LK1 retains the existing verified LK
bearer path and a separate integration token.

## Delegation contract

The JOSE header is exact: `alg=RS256`,
`typ=phub-subscription-runtime-actor-delegation+jwt`, and an allowlisted `kid`.
Remote key URLs and embedded keys are rejected. Configured RSA public keys must be
at least 2048 bits.

The exact v1 claims bind issuer, scalar audience, PadlHub user and tenant UUIDs,
active session ID, provider mapping ID, server-resolved Viva profile ID, action,
scope `subscription-runtime.quote`, correlation ID, canonical request digest and
an idempotency-key digest. `nbf` equals `iat`; maximum TTL is 60 seconds and clock
skew is bounded to five seconds.

Only `CREATE_GAME` and `JOIN_GAME` are admissible in this source slice. The quote
body still contains no actor, tenant, provider identity, price or subscription
state.

## Replay and rotation

Every verified `issuer + jti` is inserted atomically into
`subscription_runtime_delegation_replays` before evaluation. A unique index rejects
reuse; a TTL index removes expired replay markers. Replay storage failure fails
closed. Application startup verifies these indexes and never creates them in
production.

The exact required indexes are:

- `subscription_runtime_delegation_issuer_jti_unique` with key
  `{ issuer: 1, jti: 1 }` and `unique: true`;
- `subscription_runtime_delegation_expiry_ttl` with key `{ expiresAt: 1 }` and
  `expireAfterSeconds: 0`.

The consume linearization point is one Mongo `insertOne` with replay-scoped
`w: majority`, a five-second operation timeout and a bounded write timeout. Only
an `E11000` that names the exact compound replay index and reports its exact key
pattern is classified as `REPLAY`. An `E11000` from another index and every other
storage error fail closed. TTL is cleanup only; correctness never waits for TTL
deletion.

The marker's `expiresAt` is the later of signed token expiry plus a configurable
retention window and actual consume time plus that window (default 300 seconds,
allowed range 60–3600 seconds), not the JWT expiry itself. This preserves a full
retention window even when a previously validated request resumes after a delay.
The window exceeds the accepted clock skew and bounded Mongo operation/write
timeouts, so a request validated near token expiry cannot race TTL cleanup. JWT
`exp` alone still controls whether a new verification is initially accepted.

Rotation order:

1. add the new public JWK to the runtime allowlist;
2. switch LK2 to the corresponding private `kid`;
3. retain the old public key for at least maximum TTL plus skew;
4. remove the old public key only after that overlap.

No signing key, integration token or live flag is provisioned by this change.

## Disposable Mongo evidence

The canonical workflow starts a pinned Mongo 7.0 container and runs
`test:subscriptions-runtime-lk2-delegation:mongo` against a random, loopback-only
database matching
`phab_sub_replay_test_<pid>_<timestamp>_<random>`.
The test refuses a non-loopback URI, applies/checks indexes only on that exact
ephemeral database and proves its removal afterward. Mongo unavailability is a
hard failure; the suite has no skip path.

The suite proves:

- readiness failure with runtime and delegation enabled, index auto-creation off,
  and both replay indexes absent;
- canonical index apply/check followed by exact unique and TTL specification
  inspection, plus failure on a same-name malformed unique index;
- three rounds of 100 concurrent consumes for one `issuer + jti`, each yielding
  exactly one `CONSUMED`, 99 `REPLAY`, and one stored marker;
- independent consumption for one issuer with 16 different JTIs and one JTI with
  16 different issuers;
- no marker for `expiresAt <= consumedAt`, a real non-duplicate Mongo failure, or
  an unexpected duplicate index failure;
- 32 concurrent verifier calls for one signed JWT yielding one actor and 31 replay
  errors;
- 11 independently signed/invalid or binding-invalid cases that do not burn the
  JTI, after which the correct same-JTI token succeeds once and then replays.

The standalone CI container proves the unique-index linearization and accepted
majority write policy on that topology. Replica-set acknowledgement under failover
is deliberately `OUT_OF_SCOPE/OPEN`; it requires a disposable replica-set test
before any runtime activation claim.

## Default-off configuration

Runtime source configuration:

```text
SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_ENABLED=false
SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_ISSUER=
SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_AUDIENCE=
SUBSCRIPTIONS_RUNTIME_LK2_PUBLIC_JWKS_JSON=
SUBSCRIPTIONS_RUNTIME_LK2_MAX_TTL_SECONDS=60
SUBSCRIPTIONS_RUNTIME_LK2_CLOCK_SKEW_SECONDS=5
SUBSCRIPTIONS_RUNTIME_LK2_REPLAY_RETENTION_SECONDS=300
SUBSCRIPTIONS_RUNTIME_LK2_TENANT_BINDINGS_JSON=
SUBSCRIPTIONS_RUNTIME_LK2_INTEGRATION_TOKEN=
```

The tenant binding maps the LK2 tenant key and UUID to the existing runtime tenant
identifier. Missing or inconsistent mappings return a fail-closed error.

## Readiness

This boundary proves source-level authentication and replay resistance only when
the canonical Mongo workflow is green on the exact source commit. It does not make
SHADOW, WARN or ENFORCE ready. SHADOW still requires a server-side legacy comparator,
configuration custody and mismatch metrics. WARN requires the shared Web/Mobile
public contract. ENFORCE additionally requires authoritative projection,
reservation, writer read-back, reconciliation and cancellation evidence.
