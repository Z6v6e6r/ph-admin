# Managed subscriptions runtime: LK1/LK2 integration plan

Status: source-only architecture baseline
Date: 2026-08-24
Authoritative owner: `ph-admin` Subscription Runtime
Activation: default `OFF`; no live activation is authorized by this document

## 1. Baseline and scope

This plan consolidates the inventory of three repositories at these exact bases:

| Repository | Base |
| --- | --- |
| `Z6v6e6r/ph-admin` | `4f612afea5a38dd5ee2e1effeb5ebf891c702d6d` |
| `Z6v6e6r/lk` | `8c4c5df856f6a2e9d8b6bd644e928789e2ab10ca` |
| `Z6v6e6r/lk2` | `d6f772b0a9f57888923b3640e751bf4b5f2b95aa` |

The first enforceable vertical is `CREATE_GAME` and `JOIN_GAME`. Training,
tournament, add-on, attendance and no-show names may exist in contracts, but they
remain shadow-only until their actual writers use this runtime and their provider
facts are proven.

This document does not authorize a live Node-RED import, Viva mutation, Mongo index
apply, PostgreSQL migration, secret change, feature-flag activation, deployment or
merge.

## 2. Decision summary

`ph-admin` remains the physical owner of the single authoritative Subscription
Runtime. The runtime is a logical server-to-server boundary inside the repository;
it must not depend on the admin UI and must be extractable later without changing
LK1 or LK2 contracts.

The decision follows the existing source of truth:

- policy v3, immutable publication, mappings, instance/aggregate schemas,
  operations, ledger and Mongo transaction patterns already live in `ph-admin`;
- LK1 currently duplicates policy evaluation, counters and pricing around the Viva
  writer and therefore must be reduced to an adapter;
- LK2 has no subscription domain or counter. Moving the runtime there would create
  a second implementation and parallel persistence;
- LK1 and LK2 must never own independent authoritative entitlement counters.

The detailed decision is recorded in
`docs/subscriptions/adr-authoritative-subscription-runtime-ownership.md`.

## 3. Non-negotiable invariants

1. A managed entitlement is decided and reserved exactly once by the central
   runtime.
2. LK1 and LK2 may own service/capacity orchestration, but not subscription balance,
   limits, policy matching or final benefit pricing.
3. Browser and mobile clients send an intent and opaque PadlHub identifiers only.
   Tenant, actor, provider identity, subscription ownership, target facts and price
   are resolved server-side.
4. Quote is non-binding. Reserve re-evaluates policy, target, price, instance,
   aggregate and freshness.
5. An ambiguous provider result never proves rejection and never releases a reserve.
6. Full-price fallback is an explicit user choice; it is never an automatic recovery
   from a rejected subscription benefit.
7. Historical decision and price snapshots are immutable. Corrections append
   compensating ledger events.
8. Managed and unmanaged products coexist explicitly. Missing managed evidence fails
   closed for the benefit, while an unmanaged legacy product keeps its current path.
9. `ENFORCE` is impossible unless exact mapping, authoritative projection, runtime
   indexes, service authentication, reconciliation and action writer readiness are
   all attested.

## 4. Current execution truth

### ph-admin

Reusable control-plane/runtime foundation exists: generic policy v3, immutable
publication transaction, exact mapping preview, strict runtime schemas, read-only
runtime context, trusted shadow quote, activation transaction and index plans.

It is not yet authoritative because there is no production instance/aggregate
projector, persisted reconciliation producer, aggregate reservation CAS, provider
saga, outbox dispatcher or CREATE/JOIN consumer.

### LK1

LK1 currently reads Viva identity/subscriptions, calculates daily conflict, executes
a local policy evaluator, claims `lk_subscription_daily_booking_ops`, calls the Viva
booking writer and performs read-back/recovery. Managed usage counters supplied to
the evaluator are not authoritative. The existing pending/read-back behavior is a
useful writer pattern, but it is not a central entitlement reservation.

A separately tracked LK1 credential-remediation prerequisite must be closed by the
security owner before any external runtime release. Credential rotation, provider
audit and live runtime changes remain separate authority boundaries and are not part
of this source-only plan.

### LK2

LK2 owns local game/roster/capacity state in PostgreSQL. `SUBSCRIPTION` is currently
only a payment/evidence mode. There is no entitlement evaluator, counter or ledger.
Home subscriptions are display projections only. JOIN is reachable; CREATE has a
repository writer but no public command route. Training and tournament are read-only.

Two level-evaluation paths already exist. A routed managed-subscription action must
use one orchestration path and must not bolt subscription checks onto both.

## 5. Consolidated gap matrix

| Capability | ph-admin | LK1 | LK2 | Classification / required action |
| --- | --- | --- | --- | --- |
| Policy v3 and immutable versions | Present | Duplicated evaluator | None | `EXISTS_AND_REUSABLE`; central only |
| Publication and exact digest | Present | Reads partial context | None | `EXISTS_AND_REUSABLE`; add runtime acknowledgment |
| Exact provider mapping | Preview/publish present | Legacy product matching remains | None | `REQUIRES_PROVIDER_EVIDENCE`; remove managed name fallback |
| Canonical target and price | Synthetic/check-only producer | Writer resolves partially | Local activity/capacity only | `MISSING` production producer |
| Subscription instance projection | Schema/read only | Viva reads | Home display projection | `MISSING` authoritative projector |
| Aggregate and counters | Schema only | Legacy daily claim | None | `MISSING` central atomic writer |
| Quote | Trusted shadow endpoint | Local evaluator | None | `EXISTS_BUT_INCOMPLETE`; version and share contract |
| Reserve/confirm/release | Test runtime only | Legacy claim/provider recovery | Capacity reservation only | `MISSING` authoritative lifecycle |
| Operation journal | Activation-specific | Mutable legacy operation | Games operation only | `MISSING` cross-system saga journal |
| Usage ledger/outbox | Activation-specific append | Missing | Generic local outbox only | `EXISTS_BUT_TEST_ONLY`; complete runtime events/dispatcher |
| Reconciliation | Missing generic worker | Legacy provider read-back | Participation expiry only | `MISSING` managed runtime worker |
| Rollout modes | No unified activation control | Hard routing | Level modes only | `MISSING`; central scoped OFF/SHADOW/WARN/ENFORCE |
| CREATE_GAME writer | No writer | Viva modular writer | Local writer unreachable | `EXISTS_BUT_LEGACY` / LK2 route missing |
| JOIN_GAME writer | No writer | Viva modular writer | Local reachable writer | `EXISTS_AND_REUSABLE` behind runtime orchestration |
| Group training writer | No runtime integration | Legacy Viva writer | Read-only | `REQUIRES_LIVE_GATE`; shadow only |
| Tournament writer | Legacy CUP path duplicated | Legacy Viva writer | Read-only | `EXISTS_BUT_DUPLICATED`; shadow only |
| Add-on writer | Missing | Missing | Missing | `MISSING` |
| Cancellation/return | Activation only | Exact legacy release, weak inactive taxonomy | Leave only | `REQUIRES_PROVIDER_EVIDENCE` and compensation lifecycle |
| No-show | Schema/policy only | No authoritative evidence | None | `REQUIRES_PROVIDER_EVIDENCE`; shadow only |
| Admin runtime UI | Draft/test surfaces | N/A | No duplicate | `EXISTS_BUT_LEGACY`; add truthful unavailable/freshness states |

## 6. Target ownership

| Concern | Owner | Notes |
| --- | --- | --- |
| Catalog, DRAFT policy, publication, mappings, rollout configuration | CUP control plane in `ph-admin` | Published policy is immutable; rollback publishes a new version |
| Policy projection, instance, aggregate, decision, reservation, operation | Subscription Runtime in `ph-admin` | One persistence and concurrency boundary |
| Usage ledger and runtime outbox | Subscription Runtime in `ph-admin` | Append-only and tenant-bound |
| Viva writer for LK1 CREATE/JOIN | LK1 Node-RED during transition | Must reserve first and report exact provider facts |
| Local Games writer for LK2 | LK2 API/domain | Owns capacity/roster only, not entitlement |
| Provider reconciliation | Subscription Runtime, using writer/provider adapters | Ambiguous result stays held until read-back |
| LK1 UI | LK1 | Displays server outcomes; no authoritative calculation |
| LK2 Web/Mobile UI | LK2 public API + shared SDK | Mobile never calls internal runtime |

## 7. Logical runtime boundary

The initial internal API is versioned and service-authenticated:

- `POST /api/internal/subscription-runtime/quote`
- `POST /api/internal/subscription-runtime/reservations`
- `POST /api/internal/subscription-runtime/reservations/:id/confirm`
- `POST /api/internal/subscription-runtime/reservations/:id/release`
- `POST /api/internal/subscription-runtime/reservations/:id/reconcile`
- `GET /api/internal/subscription-runtime/operations/:id`

Tenant and actor are derived from authenticated server context, never trusted from
the body. A public client supplies only action, PadlHub target ID, optional expected
revision, optional opaque local subscription instance and payment intent.

Stable outcomes:

- `ENTITLEMENT_APPLIED`
- `FULL_PRICE_ONLY`
- `SUBSCRIPTION_SELECTION_REQUIRED`
- `PRICE_CONFIRMATION_REQUIRED`
- `SERVICE_BLOCKED`
- `RETRY_LATER`
- `RECONCILIATION_REQUIRED`

Reason-code metadata is centralized: safe user message, retryability, recovery
action, HTTP mapping and bounded observability class. LK1/LK2 consume generated
contract artifacts or a versioned shared fixture corpus; they do not maintain three
hand-copied enums.

## 8. Concurrency and saga boundary

The central aggregate transaction/CAS must recheck and update all relevant limits in
one boundary: active services, daily/weekly/monthly units, future bookings, remaining
units and active reservations.

The cross-system sequence is:

1. non-binding quote;
2. central re-evaluation and reserve;
3. durable operation/decision/price snapshot;
4. LK1 Viva writer or LK2 local writer;
5. exact writer/provider read-back;
6. central confirm/consume, definite-rejection release, or ambiguous reconciliation;
7. append ledger/outbox events.

LK2 capacity reservations and LK1 legacy booking journal may remain local receipts,
but neither may reserve managed entitlement. A rollback to legacy dispatch must not
delete a pending central reservation; it stays subject to reconciliation/TTL.

## 9. Action readiness

| Action | OFF | SHADOW | WARN | ENFORCE |
| --- | --- | --- | --- | --- |
| LK1 CREATE_GAME | Legacy preserved | Requires central read-only quote | Requires UI contract | No-Go until reserve/provider saga/reconciliation |
| LK1 JOIN_GAME | Legacy preserved | Requires central read-only quote | Requires UI contract | No-Go until reserve/provider saga/reconciliation |
| LK2 JOIN_GAME | Existing local path | Requires one API orchestrator/client | Requires additive Web/Mobile contract | No-Go until non-bypassable reserve/confirm/recovery |
| LK2 CREATE_GAME | Local writer unreachable | Blocked by missing command route | Blocked | No-Go |
| BOOK_GROUP_TRAINING | Legacy/read-only preserved | Quote may be evaluated | UI only after truthful writer state | No-Go |
| BOOK_TOURNAMENT | Legacy/read-only preserved | Quote may be evaluated | UI only after truthful writer state | No-Go |
| PURCHASE_ADD_ON_PRODUCT | No writer | Schema/impact preview only | No-Go | No-Go |

## 10. Implementation and PR sequence

1. **ph-admin contract/control-plane PR**: generic runtime compatibility manifest,
   fail-closed sale-readiness, projector checkpoint contract, reason codes,
   publication acknowledgment and generated schemas; all default-off.
2. **ph-admin persistence PR**: instance projector, aggregate/reservation CAS,
   operations, ledger/outbox, expiry/reconciliation and disposable replica-set tests.
3. **LK2 shadow PR**: one server-only runtime client, additive quote/API/SDK contract,
   one JOIN orchestrator, Web states and Mobile-compatible types; no enforce.
4. **LK1 shadow PR**: modular Node-RED thin adapter, service-auth contract, comparison
   journal, exact source provenance and rollback candidate; no live import.
5. **CREATE/JOIN enforcement PRs**: writer-specific reserve/confirm/reconcile and
   cancellation compensation after cross-client race evidence.

Old branches are evidence, not integration branches. Only independently verified
commits or manually scoped changes may be transferred. Tariff/product/station IDs
must not become compiled runtime capability constants.

## 11. Rollout stages and gates

| Stage | Scope | Required evidence | Rollback/stop |
| --- | --- | --- | --- |
| 0 Compatible | All flags OFF | Build/contracts/tests, no runtime behavior change | Disable artifacts; no data cleanup |
| 1 Projections | Read-only policy/instance/target/price | Exact mapping, freshness, checkpoint recovery | Stop projector; retain immutable evidence |
| 2 SHADOW LK2 | Quote only | Tenant/actor binding, latency, mismatch metrics | Disable LK2 client |
| 3 SHADOW LK1 | Quote + legacy comparison | Fresh modular source, no mutation, mismatch journal | Disable LK1 adapter |
| 4 WARN | Advisory UI | Stable codes, truthful pricing, old-client behavior | Return to SHADOW |
| 5 Limited ENFORCE | Exact tenant/product/station/cohort, CREATE/JOIN only | Atomic race, provider read-back, reconciliation, alerts | Kill action/product scope; reconcile holds |
| 6 Expansion | Additional proven writers | Writer-specific GO evidence | Revert affected scope only |

Expansion stops on duplicate booking/consumption, price mismatch, cross-tenant
access, stale projections, read-back mismatch, excessive reconciliation backlog,
missing ledger event, aggregate/ledger divergence or inability to roll back.

## 12. Current blockers

### SHADOW

- authoritative instance/aggregate/target/price projections;
- persisted projector checkpoint writer and freshness/recovery;
- service-authenticated clients and redacted comparison metrics;
- removal/rotation response for the committed LK1 credential.

### WARN

- generated stable reason-code contract;
- LK1 and LK2 client states for alternatives/selection/price change/retry;
- acceptable shadow mismatch and data-quality thresholds.

### CREATE/JOIN ENFORCE

- aggregate reservation CAS and cross-client final-unit race proof;
- idempotent operation journal and immutable price snapshot;
- exact provider/writer read-back;
- ambiguous timeout reconciliation and cancellation compensation;
- exact managed mapping with no name fallback;
- reviewed indexes, service identities, metrics/alerts and rollback candidate.

### Live-only

- credential rotation/revocation and secret provisioning;
- sanitized Golden HAR/provider contract confirmation;
- Mongo topology/index preflight/apply and backup/restore proof;
- feature-flag activation, Node-RED import, deployment and rendered post-check.

## 13. Immediate next package

Implement the default-off ph-admin contract/control-plane PR:

- manually port generic runtime compatibility and runtime acknowledgment;
- retain fail-closed sale-readiness (`ready:false`) and projector checkpoint schema;
- eliminate tariff-coded capability manifests;
- define the canonical outcome/reason/action schemas and shared fixtures;
- add focused negative/compatibility tests and document all default-off flags.

Definition of Done for this package: source schemas generated, publication cannot
claim incompatible runtime delivery, sale-readiness cannot become true without an
authoritative projector checkpoint, no provider mutation is possible, all existing
subscription suites and build pass, and no live action occurs.
