# Residency monetary booking

Owner: CUP subscription domain. Audience: authenticated holders of Viva product
`4037a3a3-e551-4f9a-a9db-1410e46b8635` and the LK1 paid booking owner.
This change prepares source support; it creates no live type, mapping or publication.

The product grants 30% off games and 50% off group training, at all stations,
for 30 days. It grants no free visits or free game minutes. Tournament benefits
and automatic renewal are outside this profile. The activation profile is PURCHASE:
the provider instance must start at `purchasedAt` and end exactly 30 days later.
An inclusive provider end timestamp one millisecond earlier is accepted. Delayed,
shorter, longer, frozen, future and expired instances fail closed.

`buildResidencyPolicyCandidate` creates a check-only `CreatePolicyVersionDto`.
The caller supplies the effective instant and reviewed canonical game/training
event IDs. It never guesses a dictionary, reads Viva or writes a database. Use
the existing catalog API to create type `{code:"residency",title:"Резидентство"}`
and its draft policy under an authorized global catalog actor. Then use the
existing digest/impact-bound preview and atomic publication command, with
`SUBSCRIPTIONS_PUBLICATION_ENFORCEMENT_ADAPTER_VERSION=LK_NODE_RED_RESIDENCY_BOOKING_V1`.
Exact Viva inspection, immutable dictionary evidence, audit, CAS, idempotency,
transaction and provider mapping gates are retained.

## Rule contract and compatibility

`BenefitRule.allStations?: boolean` is additive. Omitted/false keeps the existing
explicit `stationIds` behavior. True requires an empty `stationIds` array and
matches every server-resolved station, including stations added later. The
normalizer preserves the field, the runtime digest binds it, and wildcard rules
participate in overlap detection. Station access rules still apply independently.
The residency profile requires wildcard scope on both monetary benefits and
`ALL_STATIONS` access without surcharge. Unknown event types remain outside the
reviewed canonical event dictionary.

Runtime zero usage is accepted only for monetary-only percentage policies below
100%, with zero units for every duration and a zero daily visit allowance.
Free-entitlement policies retain positive-unit validation. Existing annual
adapter behavior and omitted wildcard fields remain unchanged.

Older readers do not implement wildcard benefits/zero usage. Deploy and verify
the new CUP readers plus the paired LK residency composer before permitting this
publication. Keep the existing publication command disabled throughout that
rollout. Do not route residency through the annual/free-entitlement adapter or
old generic managed JOIN. The new capability digest attests the monetary profile;
policy/dictionary digests additionally pin the exact event selectors.

## Authenticated read contract

`POST /api/internal/subscriptions/residency-booking-context` accepts the existing
`{clientSubscriptionId}` DTO, LK bearer and `X-Subscriptions-Integration-Token`.
It requires both the existing runtime-context flag and the new default-off
`SUBSCRIPTIONS_RESIDENCY_BOOKING_CONTEXT_ENABLED` flag. The original
`runtime-context` endpoint and its exact schema-1 response remain unchanged.

The new response contains `contextKind=RESIDENCY_BOOKING_CONTEXT`, the exact
provider product ID, `purchasedAt`, runtime compatibility, the existing context,
`observedAt` and `validUntil`. The service first verifies bearer ownership, tenant,
client hash, exact VERIFIED mapping, pinned sale-period publication, policy digest
and fresh provider-instance evidence. It additionally verifies the residency
profile, ACTIVE state, purchase interval and supported capability.

The read is non-mutating. It creates no entitlement or booking. Its validity ends
at the earliest of 30 seconds, the instance expiry, mapping freshness deadline,
and instance freshness deadline. LK must repeat the read before writing and bind
the exact policy/publication/instance and price into its existing durable operation.

## Release and recovery boundaries

The paired LK change uses the existing paid booking/transaction owner, with
`subscriptionVisitCount=0` and no visit decrement. Its own flag is off by default.
Deployment, runtime configuration, real dictionary/Viva evidence, publication,
instance projection and provider acceptance remain separate operational steps.
No key, permission, migration or live data is provisioned by this change.

Before enabling, verify both exact source revisions, flags, audit/index/transaction
readiness and source-generated Node-RED candidate. Stop on an unsupported capability,
missing/expired context, wrong target, changed policy/price or ambiguous provider
outcome. Disable residency admission and publication commands to stop new work;
this does not undo saved bookings or payments. Preserve the existing durable
operation/readback recovery owner. After wildcard/zero-usage publications exist,
retain compatible readers and use a reviewed forward fix rather than old readers.

Local evidence: candidate DTO/catalog validation, all-station/zero-usage quotes,
publication preview/replay, old schema-1 compatibility, stale/foreign/disabled
evidence, interval and near-freshness-deadline checks. These do not prove a real
Viva price, payment, booking or production rollout.

The admin benefit editor preserves every selected action and has an explicit all-stations checkbox. A blank station list keeps the legacy explicit-list meaning; only the checkbox writes `allStations: true` with an empty list. Opening and saving a published residency policy must retain both game actions and its wildcard.
