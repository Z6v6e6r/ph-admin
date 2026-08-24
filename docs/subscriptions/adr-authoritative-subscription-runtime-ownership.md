# ADR: Authoritative subscription runtime ownership

Status: Accepted for source implementation
Date: 2026-08-24

## Context

Managed subscription behavior must be identical in LK1, LK2 Web and LK2 Mobile.
The existing estate has policy/publication models in ph-admin, a distributed legacy
evaluator/counter/provider writer in LK1 and no subscription command domain in LK2.
Independent counters or evaluators would permit double consumption and inconsistent
prices.

## Decision

The single authoritative Subscription Runtime is a logical server-to-server module
physically hosted in `ph-admin` for the first release. CUP remains the control plane;
the runtime is not the admin UI and has separate internal API, authentication,
permissions, feature flags and operational lifecycle.

1. **Eligibility execution:** Subscription Runtime in `ph-admin`.
2. **Entitlement aggregate:** Mongo persistence owned exclusively by that runtime.
3. **Operation journal:** Runtime-owned, tenant/actor/action/target/idempotency-bound.
4. **Usage ledger:** Runtime-owned append-only ledger with compensating events.
5. **Policy publication:** CUP control plane in `ph-admin`; published versions are
   immutable and rollback creates a new version.
6. **LK1 call path:** browser intent -> LK1 Node-RED adapter -> internal runtime.
   Browser never receives the integration credential.
7. **LK2 call path:** Web/Mobile -> LK2 public API -> one LK2 runtime client. Web and
   Mobile never call the internal runtime.
8. **Provider mutation:** existing LK1 Viva writer during transition; LK2 owns only
   the local writer actions it actually implements. Each writer reports exact facts.
9. **Reconciliation:** runtime-owned operation state machine using writer/provider
   read adapters; ambiguous results remain reserved.
10. **Double-reserve prevention:** one aggregate transaction/revision-CAS covers all
    counters and reservations, irrespective of source client.
11. **Disable path:** scoped OFF/SHADOW/WARN/ENFORCE activation plus independent
    quote/reserve/confirm/reconcile kill switches. Disabling dispatch never deletes
    pending reservations.
12. **Legacy subscriptions:** explicit `UNMANAGED_LEGACY`, `SHADOW_MAPPED`,
    `MANAGED_WARN`, `MANAGED_ENFORCED`, `DISABLED` classification. Legacy is not
    migrated automatically.

Critical invariant: **LK1 and LK2 cannot have independent authoritative counters.**

## Consequences

- LK1 local evaluator and `lk_subscription_daily_booking_ops` remain compatibility
  machinery only for unmanaged products; they cannot decide managed ENFORCE.
- LK2 capacity/roster persistence stays local and authoritative for Games, while
  entitlement persistence stays remote and authoritative for subscriptions.
- The cross-system operation is a saga. Reserve, writer result, confirm/release and
  reconciliation require durable idempotency and immutable snapshots.
- A later service extraction moves the internal API implementation and persistence
  adapter, not the LK1/LK2 client contracts.
- Training, tournament, add-on and no-show remain non-enforceable until real writer
  and provider-evidence gates pass.

## Alternatives rejected

### LK2 as physical owner

Rejected for the initial release: it would require moving or rewriting the existing
policy/publication/runtime domain and would introduce parallel PostgreSQL persistence
while LK1 still relies on ph-admin/Viva contracts.

### LK1/Node-RED as owner

Rejected: LK1 already contains duplicated evaluation, counters and tariff-specific
logic, and it cannot safely coordinate LK2 consumption.

### Client-side evaluation

Rejected: clients cannot be trusted with price, provider IDs, ownership, balance,
policy version or counters, and Mobile would become a fourth implementation.

## Compatibility and rollout

All integration is additive and default-off. OFF preserves unmanaged legacy behavior;
SHADOW performs read-only comparison; WARN exposes advisory outcomes without claiming
an authoritative charge; ENFORCE is available only for an exact ready scope. A kill
switch returns new requests to the prior mode while pending operations continue
reconciliation.
