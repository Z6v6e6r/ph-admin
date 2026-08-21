# Managed annual subscriptions: control-plane v3 checkpoint

Status: `DRAFT ONLY`. This checkpoint defines and validates the settings model
and the three CUP sections. It does not publish a policy, create a real client
subscription, write to Viva, reserve entitlement, charge money or produce fake
business analytics.

## Policy v3

The additive v3 policy keeps the v2 scalar fields for API compatibility and
adds the exact selectors required by the LK evaluator:

- `activeServicesLimit { enabled, max, scope }`;
- `bookingWindow { enabled, days }`;
- ordered `stationAccessRules` for home, selected or all stations, each with an
  independent fixed surcharge;
- benefit rules with exact action, event type, product type, duration and
  station selectors;
- `PARTIAL_PRICE_PERCENT_DISCOUNT` with integer fraction and percentage, for
  example `1 / 4` of the server price followed by a `20%` discount;
- `ADD_ON_PRODUCT` + `PURCHASE_ADD_ON_PRODUCT` for appendable product benefits.

Old model-v2 rows remain readable. New writes use stored schema v3. Legacy and
v2 idempotency request hashes remain replay-compatible. A pure compiler emits
LK `runtimeSchemaVersion: 1` only for explicit `PUBLISHED` model-v3 policies.
The isolated first-publication candidate is default-off, requires a matching
read-only preview, exact Viva/dictionary evidence, durable approval audit and
one Mongo transaction. See
`managed-annual-subscriptions-publication-command.md`. No existing DRAFT is
published merely by deploying the candidate.

## CUP sections

1. **Настройка подписки** — DRAFT catalogue, policy versions and release
   programmes. Switchable limits, station rows and benefit rows are editable.
2. **Список подписок** — currently an explicit unavailable state. It must not
   imply that there are zero subscriptions. Mutations are disabled.
3. **Аналитика** — currently an explicit unavailable state. It must not display
   zero for an absent ledger or provider source.

`No-show` means an authoritative attendance status confirming that the client
did not attend and did not cancel in time. It must never be inferred only from
the absence of an active booking.

## Required persistence before instance management

Collections are separate from immutable policy documents:

- `subscription_provider_mappings`: unique verified
  `(tenantId, provider, providerProductId, providerScope)`;
- `subscription_instances`: unique local ID and unique provider identity,
  including provider client ID, exact `clientSubscriptionId`, pinned policy
  version/digest, home station and lifecycle dates;
- `subscription_operations`: idempotency fingerprint, decision/money snapshot,
  Saga state and reconciliation timestamps;
- `subscription_entitlement_aggregates`: one per instance, with revision and all
  active/daily/weekly/monthly/future counters updated by one atomic CAS;
- `subscription_usage_ledger`: append-only, unique `eventId`, correlation,
  provider evidence reference and usage/money deltas.

Indexes must be introduced through check -> duplicate preflight -> apply ->
recheck. Until this schema and provider identity scope are approved, no real
instance rows or zero-valued analytics projections are created.

## Analytics contract

The future overview returns a source status and nullable metrics. `UNAVAILABLE`
is distinct from `0`. Required metrics include:

- active, purchased and renewed subscriptions;
- new versus renewed clients;
- clients not renewed after 7, 14, 21 and 30 days, with a station-scoped masked
  drill-down;
- average and distribution of visits for the selected period;
- revenue, refunds, LTV, breakage and contribution margin;
- slot fill rate with and without subscriptions, peak-load share and denied
  demand;
- entitlement overdraft capacity: reserved but not yet provider-confirmed units
  and money;
- cohort retention by release phase, price and home station;
- comparison with the immediately preceding equal-length period.

Every metric records ledger watermark/freshness and reconciliation status.
PII export has a separate permission and audit event.

## Runtime stop gates

The LK evaluator must not be connected to the mutation path until all gates are
closed:

1. verified product mapping and actor-owned instance projection;
2. service-authenticated, tenant-bound, digest-protected, freshness-bounded CUP
   projection consumed by Node-RED;
3. single atomic reservation/CAS covering every affected limit;
4. exact provider read-back and restart reconciliation;
5. sanitized Golden HARs for identity, 60/90/120 create/join, partial price,
   station surcharge, payment timeout, cancellation, refund and no-show;
6. shadow quote on reserve/dev with no provider mutation.

Unmapped legacy plans retain their existing flow. Once a provider product is
explicitly mapped to managed runtime, missing or stale evidence fails closed and
must never fall back to name-based legacy rules.

## Test matrix for the next checkpoint

- identity: exact product/client/clientSubscription ownership and mismatch;
- evaluator: toggles off/on, 3-active limit race, 3/4/5-day window boundaries;
- station rows: home, selected, all, surcharge, no match and equal-priority
  overlap;
- benefits: 60 free, 90 quarter-minus-N-percent, 120 disabled, game discount
  disabled while group/tournament remains enabled, add-on product match/miss;
- Saga: duplicate idempotency replay/conflict, provider timeout-after-accept,
  restart, out-of-order callbacks and exact reconciliation;
- compensation: early/late/client/station cancellation, refund, unpaid expiry
  and confirmed no-show;
- analytics: nullable unavailable state, watermark freshness, equal-period
  comparison, masked/scoped drill-down and ledger reconciliation;
- UI: desktop/mobile, loading/error/empty/unavailable, keyboard navigation and
  disabled financial actions.
