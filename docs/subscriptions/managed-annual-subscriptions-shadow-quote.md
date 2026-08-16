# Managed annual subscriptions: internal shadow quote

Status: **checkpoint candidate / default off / internal only**.

This checkpoint adds a deterministic, read-only eligibility and price calculation for a
future LK adapter. It does not add an HTTP route or UI, and it does not publish a policy,
reserve entitlement, call Viva, charge money, append ledger/outbox events, or mutate MongoDB.

## Enablement

Both flags must be enabled and the freshness limit must be explicit:

```dotenv
SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED=true
SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED=true
SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS=60
```

The accepted freshness range is 30 to 3600 seconds. Missing or invalid configuration fails
closed. These variables remain off/blank in the deployment example for this checkpoint.

## Trusted inputs

The service accepts only an internal `SubscriptionShadowQuoteRequest` built from:

- `LK_IDENTITY`: tenant and one-way `clientRefHash` resolved from an authenticated LK session;
- `SERVER`: canonical target, station, event/product type, duration, start, dictionary revision,
  base price and evidence references resolved by a future server adapter.

None of these values may come directly from a browser body. Until those two authoritative
resolvers exist, there is deliberately no public or admin endpoint.

## Read boundary

The service reads and validates four stored documents:

1. the tenant-owned subscription instance;
2. its verified Viva product mapping;
3. the exact pinned policy publication and projection digest;
4. its reconciled entitlement aggregate.

The mapping, instance, aggregate, LK identity and target resolution must be fresh. The policy
dictionary revision must equal the server target dictionary revision. A pinned `SUPERSEDED`
publication remains valid for an existing instance; `DISABLED_FOR_NEW_OPERATIONS` blocks it.
Studio-scoped Viva mappings fail closed until the canonical studio-to-station resolver exists.
The cold connection uses `VERIFY_ONLY`; concurrent connection attempts with a different mode fail
closed in either ordering instead of silently joining an index-creating or verify-only attempt.

## Eligibility rules

The evaluator checks, without reserving anything:

- instance state and validity period;
- policy effective time and optional booking after expiry;
- create/join toggles and duration rules;
- calendar booking window in `Europe/Moscow` (`days=4` means local date offsets 0, 1, 2, 3);
- blackout dates;
- active service, daily, weekly, monthly, future booking and remaining-unit limits;
- station access, station surcharge and highest numeric priority (equal highest priorities block);
- exact category, action, event type, product type, duration and station benefit match.

`ALL_BOOKINGS` active-service scope and `minHoursBetweenUses > 0` block explicitly because the
current aggregate does not contain their authoritative evidence. They must never be treated as
zero. This is also why a successful quote is marked `nonBinding=true` and
`requiresReservationRecheck=true`.

## Pricing

Money uses integer minor units and RUB only. Multiplication/division floors the fractional minor
unit. A server-confirmed base price and price evidence are mandatory. Station surcharge is added
after the benefit calculation. A fixed price above the confirmed base price is invalid.

For `PARTIAL_PRICE_PERCENT_DISCOUNT`, the fraction is calculated first, then the percentage is
discounted from that fractional charge. Example: base 100,003, fraction 1/4, discount 20%,
surcharge 1,000 results in `floor(100003/4)=25000`, discount 5,000, final 21,000.
The quote exposes 5,000 as the percentage discount inside the partial-price calculation and 80,003
as total `discountMinor`, so the invariant `base - discount + surcharge = final` always holds.

A disabled or absent GAME benefit leaves the action eligible at the full base price (plus station
surcharge), which supports the requirement to switch off the game discount independently. For
group training, tournament and add-on product, no exact enabled benefit match blocks entitlement.

## Safe recovery and next gate

Recovery is disabling `SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED`; there are no checkpoint-created data
or indexes to roll back. Before exposing this to DEV LK, add the authenticated identity resolver and
canonical event/price/dictionary resolver, then contract-test their output against this service.
That adapter must remain shadow-only until a separate reviewed atomic reservation and provider
confirmation flow is approved.
