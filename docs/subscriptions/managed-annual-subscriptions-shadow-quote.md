# Managed annual subscriptions: internal shadow quote

Status: **checkpoint candidate / default off / trusted internal adapter**.

This checkpoint adds a deterministic, read-only eligibility and price calculation for a
trusted LK server adapter. It does not add a browser/public quote route or UI, and it does not
publish a policy, reserve entitlement, charge money, append ledger/outbox events, or mutate
subscription MongoDB collections.

## Enablement

Both flags must be enabled and the freshness limit must be explicit:

```dotenv
SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED=true
SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED=true
SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS=60
SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED=true
SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED=true
SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_TOKEN=<at-least-32-bytes>
SUBSCRIPTIONS_RUNTIME_TENANT_ID=iSkq6G
SUBSCRIPTIONS_RUNTIME_HASH_PEPPER=<at-least-32-bytes>
```

The accepted freshness range is 30 to 3600 seconds. Missing or invalid configuration fails
closed. These variables remain off/blank in the deployment example for this checkpoint.

## Trusted inputs

`POST /api/internal/subscriptions/shadow-quote` accepts only a trusted server-to-server request.
It requires both headers:

- `Authorization: Bearer <LK JWT>`;
- `X-Subscriptions-Integration-Token: <dedicated token>`.

The browser must not call this endpoint directly. The adapter verifies the LK JWT in CUP, requires
the verified canonical Viva client id, checks the configured tenant, and derives `clientRefHash`
as HMAC-SHA256 with a versioned input. Phone, subject, provider client id, bearer and integration
token are not returned. The same HMAC contract must be used when a future reconciler creates a
runtime subscription instance.

The request body contains only `subscriptionInstanceId`, `action` and a target reference with
`targetId` plus `snapshotRevision`. Station, event/product type, duration, start, dictionary
revision, price and evidence references are forbidden body fields.

The service then builds an internal `SubscriptionShadowQuoteRequest` from:

- `LK_IDENTITY`: tenant and one-way `clientRefHash` resolved from an authenticated LK session;
- `SERVER`: an exact immutable row from `subscription_canonical_target_snapshots`, selected by
  tenant, target, action and revision.

Identity, station, dictionary and price fields never come from the body. The resolver accepts only
an `ACTIVE`, non-expired snapshot whose `observedAt` is within the configured shadow freshness
window. The snapshot validator requires action/category compatibility, RUB integer minor units and
both target and price evidence references. There is deliberately no public/browser quote endpoint.

This checkpoint deliberately provides no snapshot write route. A separately reviewed trusted
projection producer must populate immutable revisions from canonical LK/Viva/CUP read models before
the resolver can return a target; missing data fails closed.

An operator-only synthetic fixture producer is documented in
`managed-annual-subscriptions-activation-gate.md`. It is restricted to synthetic targets and
DEV/TEST databases, has no controller route and does not establish provider truth. A real target
remains unavailable until the Golden HAR contract is satisfied.

## Viva product evidence preview

The separate admin-only read endpoint
`POST /api/v1/admin/subscription-types/:subscriptionTypeId/policy-versions/:version/provider-mapping-preview`
is also default-off:

```dotenv
SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_ENABLED=true
SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_CLIENT_ID=<synthetic-viva-client-id>
```

It reads the exact DRAFT policy `providerBinding.externalId`, then performs only
`GET /api/v1/products/subscriptions/{productId}` in Viva using the server-configured synthetic
client and the supplied `providerStudioId` context. The admin body cannot select or enumerate Viva
clients. Until canonical studio-to-station mapping exists, the endpoint additionally requires
global `subscriptions:catalog:write` station scope; station-scoped administrators fail closed.
The response is sanitized and always says
`evidenceState=EVIDENCE_ONLY`, `persisted=false`, `verified=false`. It never stores a mapping and
never treats `clientSubscriptionId` as a product id. Until an independently verified canonical
studio-to-station mapping exists, the response includes blocking issues and cannot activate the
runtime. The provider-reported cost is returned with `costUnit=UNVERIFIED`; it is not used as a
minor-unit price until a HAR/API contract confirms its unit.

Viva `404` is a non-retryable exact-product rejection. Provider `401/403`, `429`, `5xx` and network
failures remain retryable upstream-unavailable responses; other provider `4xx` are non-retryable
request rejections. Neither read-only POST participates in the generic mutation-audit interceptor,
so a successful preview or shadow quote does not append an admin audit document.

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

Recovery is disabling `SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED`,
`SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED` and
`SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_ENABLED`; there are no checkpoint-created data or indexes
to roll back at application level. Runtime indexes are retained if they were separately applied.
The next gate is a trusted projection producer plus Golden HAR/dictionary proof and synthetic
snapshots. The adapter remains shadow-only until a separate reviewed atomic reservation and
provider confirmation flow is approved.
