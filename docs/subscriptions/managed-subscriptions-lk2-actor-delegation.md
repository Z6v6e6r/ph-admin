# LK2 actor delegation for Subscription Runtime

Status: source-only, default-off
Date: 2026-08-24

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

Rotation order:

1. add the new public JWK to the runtime allowlist;
2. switch LK2 to the corresponding private `kid`;
3. retain the old public key for at least maximum TTL plus skew;
4. remove the old public key only after that overlap.

No signing key, integration token or live flag is provisioned by this change.

## Default-off configuration

Runtime source configuration:

```text
SUBSCRIPTIONS_RUNTIME_LK2_DELEGATION_ENABLED=false
SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_ISSUER=
SUBSCRIPTIONS_RUNTIME_LK2_EXPECTED_AUDIENCE=
SUBSCRIPTIONS_RUNTIME_LK2_PUBLIC_JWKS_JSON=
SUBSCRIPTIONS_RUNTIME_LK2_MAX_TTL_SECONDS=60
SUBSCRIPTIONS_RUNTIME_LK2_CLOCK_SKEW_SECONDS=5
SUBSCRIPTIONS_RUNTIME_LK2_TENANT_BINDINGS_JSON=
SUBSCRIPTIONS_RUNTIME_LK2_INTEGRATION_TOKEN=
```

The tenant binding maps the LK2 tenant key and UUID to the existing runtime tenant
identifier. Missing or inconsistent mappings return a fail-closed error.

## Readiness

This boundary proves source-level authentication and replay resistance only. It
does not make SHADOW, WARN or ENFORCE ready. SHADOW still requires a server-side
legacy comparator and mismatch metrics. WARN requires the shared Web/Mobile public
contract. ENFORCE additionally requires authoritative projection, reservation,
writer read-back, reconciliation and cancellation evidence.
