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
  confirmation can release without provider evidence.

Each active reservation stores its exact local day/week/month keys and deltas so rollback never
recomputes historical policy. Legacy reservations without this evidence fail closed to manual
reconciliation.

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
